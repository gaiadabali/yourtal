import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { sessionFor } from "../../shared/testing/session-for";

/**
 * 5.13.v: a teen who signed up but whose guardian has not approved yet can
 * not earn, over the real HTTP stack, and `GET /api/me` says so (`awaitingGuardian`). Every watch-and-earn route is refused
 * by `campaign_view.yaml`'s `teen-earns-only-with-guardian-consent` before
 * its handler runs. The approved control proves the refusal is the consent,
 * not something else about the fixture.
 */
const owner: AppDb = createAppDb(process.env["DATABASE_OWNER_URL"] ?? "");
const campaignId = randomUUID();
const originalTeenAccounts = process.env["TEEN_ACCOUNTS"];
let app: NestFastifyApplication;

/** An `Etc/GMT` zone where it is about noon now, so teen quiet hours (21:00-07:00) never interfere. */
function noonTimezone(): string {
  const offset = 12 - new Date().getUTCHours(); // -11..12, all valid Etc/GMT zones
  if (offset === 0) return "Etc/GMT";
  return offset > 0 ? `Etc/GMT-${String(offset)}` : `Etc/GMT+${String(-offset)}`;
}

function randomTestIp(): string {
  const [a, b, c] = randomBytes(3);
  return `10.${String(a)}.${String(b)}.${String(c)}`;
}

async function registerPendingTeen(): Promise<{ userId: string; cookie: string }> {
  const register = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    remoteAddress: randomTestIp(),
    headers: { "idempotency-key": randomUUID() },
    payload: {
      email: `teen-pending-earn+${randomUUID()}@example.test`,
      password: "not-a-real-secret-5-13-v",
      region: "AU",
      locale: "en-AU",
      displayName: "Pending Teen",
      dateOfBirth: "2012-01-01",
      timezone: noonTimezone(),
      guardianEmail: `guardian+${randomUUID()}@example.test`,
    },
  });
  expect(register.statusCode).toBeLessThan(300);
  const { userId, token } = register.json<{ userId: string; token: string }>();
  return { userId, cookie: `yt_session=${token}` };
}

async function setConsent(userId: string, status: "pending" | "granted"): Promise<void> {
  await owner.execute(
    sql`UPDATE identity.user_profile SET parent_consent_status = ${status} WHERE user_id = ${userId}`,
  );
}

function expectGuardRefusal(response: { statusCode: number; json: () => unknown }): void {
  expect(response.statusCode).toBe(403);
  expect(response.json()).toMatchObject({ code: "forbidden" });
}

beforeAll(async () => {
  process.env["TEEN_ACCOUNTS"] = "true";
  await owner.execute(sql`
    INSERT INTO campaign.campaigns
      (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
       estimated_data_mb, reward_points, question_count, scoring_rule,
       lifecycle_state, published_at, business_id, region, audience, content_category,
       poster_url, teaser_url, hls_url, aspect, estimated_bytes,
       starts_at, ends_at, open_viewing, teaser_start_seconds)
    VALUES
      (${campaignId}, 'quick', '5.13.v e2e fixture', ${randomUUID()}, 'e2e merchant',
       'fixture', 60, 5, 100, 1, 'base_only',
       'live', now(), ${randomUUID()}, 'AU', 'all_ages', 'entertainment',
       'https://example.test/poster.jpg', 'https://example.test/teaser.m3u8',
       'https://example.test/hls.m3u8', '16:9', 1000000,
       now(), now() + interval '30 days', false, 0)
  `);
  await owner.execute(sql`
    INSERT INTO campaign.terms_version
      (campaign_id, version, reward_points, question_count, scoring_rule, duration_seconds, accuracy_bonus_points, effective_from)
    VALUES (${campaignId}, 1, 100, 1, 'base_only', 60, 0, now())
  `);
  await owner.execute(sql`
    INSERT INTO campaign.video_source (campaign_id, kind, manifest_url)
    VALUES (${campaignId}, 'hls', 'https://example.test/hls.m3u8')
  `);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
  if (originalTeenAccounts === undefined) delete process.env["TEEN_ACCOUNTS"];
  else process.env["TEEN_ACCOUNTS"] = originalTeenAccounts;
  for (const table of ["checkpoint_issue", "checkpoint_nonce", "coverage"] as const) {
    await owner.execute(sql`
      DELETE FROM ${sql.raw(`watch.${table}`)} WHERE session_id IN
        (SELECT id FROM watch.session WHERE campaign_id = ${campaignId})
    `);
  }
  await owner.execute(sql`DELETE FROM watch.session WHERE campaign_id = ${campaignId}`);
  await owner.execute(sql`DELETE FROM campaign.terms_version WHERE campaign_id = ${campaignId}`);
  await owner.execute(sql`DELETE FROM campaign.video_source WHERE campaign_id = ${campaignId}`);
  await owner.execute(sql`DELETE FROM campaign.campaigns WHERE id = ${campaignId}`);
});

describe("a teen before guardian approval", () => {
  it("an adult is never awaiting a guardian", async () => {
    const adult = await sessionFor(app);
    const response = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: adult.cookie },
    });
    expect(response.json()).toMatchObject({ awaitingGuardian: false });
  });

  it("can read the campaign but every earning route is refused; approved, the same teen starts", async () => {
    const teen = await registerPendingTeen();
    const me = () =>
      app.inject({ method: "GET", url: "/api/me", headers: { cookie: teen.cookie } });
    expect((await me()).json()).toMatchObject({ awaitingGuardian: true });

    const read = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignId}`,
      headers: { cookie: teen.cookie },
    });
    expect(read.statusCode).toBe(200);

    const start = () =>
      app.inject({
        method: "POST",
        url: "/api/watch/sessions",
        headers: { cookie: teen.cookie, "idempotency-key": randomUUID() },
        payload: { campaignId },
      });
    expectGuardRefusal(await start());

    // Control: approved, the same request is admitted.
    await setConsent(teen.userId, "granted");
    expect((await me()).json()).toMatchObject({ awaitingGuardian: false });
    const started = await start();
    expect(started.statusCode).toBe(201);
    const sessionId = started.json<{ session: { id: string } }>().session.id;

    // Back to pending: the session it already holds earns nothing either.
    await setConsent(teen.userId, "pending");
    const now = new Date().toISOString();
    const routes = [
      { method: "GET", url: `/api/watch/sessions/${sessionId}` },
      {
        method: "POST",
        url: `/api/watch/sessions/${sessionId}/progress`,
        payload: { fromSeconds: 0, toSeconds: 2, reportedAt: now },
      },
      { method: "POST", url: `/api/watch/sessions/${sessionId}/checkpoints/0` },
      {
        method: "POST",
        url: `/api/watch/sessions/${sessionId}/checkpoints/0/answer`,
        payload: { token: "x", optionId: randomUUID() },
      },
      { method: "POST", url: `/api/watch/sessions/${sessionId}/complete` },
    ] as const;
    for (const route of routes) {
      const response = await app.inject({
        method: route.method,
        url: route.url,
        headers: { cookie: teen.cookie, "idempotency-key": randomUUID() },
        ...("payload" in route ? { payload: route.payload } : {}),
      });
      expectGuardRefusal(response);
    }
  });
});
