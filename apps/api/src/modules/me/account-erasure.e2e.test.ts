import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deletionPlan } from "@yourtal/consent/dsar";
import { AppModule } from "../../app.module";
import { sessionFor } from "../../shared/testing/session-for";
import type { TestSession } from "../../shared/testing/session-for";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import type { AppDb } from "../../shared/persistence/drizzle-client";

/**
 * Group 1.20, end to end: `DELETE /api/me` erases every personal table the
 * viewer has rows in, and `GET /api/me/data-export` showed those rows first.
 * Two people, one deleted: the other's rows must still be there.
 *
 * Fixture rows that no endpoint writes are inserted as the owner; the ones an
 * endpoint does write (interests, settings, a notification choice, a link
 * code) go through the endpoint, so the export and the erasure meet real data.
 */
let app: NestFastifyApplication;
const owner: AppDb = createAppDb(process.env["DATABASE_OWNER_URL"] ?? "");
let campaignId = "";

/** Tables keyed by the person's id, and what a person who used everything has in each. */
const ME_TABLES = [
  "me.interest",
  "me.follow",
  "me.save",
  "me.link_code",
  "me.streak_state",
  "me.notification",
  "me.notification_preference",
  "me.viewer_setting",
  "me.viewer_theme",
  "me.voucher_expiry_warning",
  "feed.demotion",
  "identity.verification_token",
  "identity.principal_security_state",
] as const;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  campaignId = randomUUID();
  await owner.execute(sql`
    INSERT INTO campaign.campaigns
      (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
       estimated_data_mb, reward_points, question_count, scoring_rule,
       lifecycle_state, published_at, business_id, region, audience, content_category,
       poster_url, teaser_url, hls_url, aspect, estimated_bytes,
       starts_at, ends_at, open_viewing, teaser_start_seconds)
    VALUES
      (${campaignId}, 'quick', 'erasure e2e fixture', ${randomUUID()}, 'erasure e2e merchant',
       'fixture', 30, 5, 100, 0, 'base_only',
       'live', now(), ${randomUUID()}, 'AU', 'all_ages', 'entertainment',
       'https://example.test/poster.jpg', 'https://example.test/teaser.m3u8',
       'https://example.test/hls.m3u8', '16:9', 1000000,
       now(), now() + interval '30 days', false, 0)
  `);
  await owner.execute(sql`
    INSERT INTO campaign.terms_version
      (campaign_id, version, reward_points, question_count, scoring_rule, duration_seconds, accuracy_bonus_points, effective_from)
    VALUES (${campaignId}, 1, 100, 0, 'base_only', 30, 0, now())
  `);
});

afterAll(async () => {
  await owner.execute(sql`DELETE FROM watch.coverage WHERE session_id IN
    (SELECT id FROM watch.session WHERE campaign_id = ${campaignId})`);
  await owner.execute(sql`DELETE FROM watch.session WHERE campaign_id = ${campaignId}`);
  await owner.execute(sql`DELETE FROM me.save WHERE campaign_id = ${campaignId}`);
  await owner.execute(sql`DELETE FROM feed.demotion WHERE campaign_id = ${campaignId}`);
  await owner.execute(sql`DELETE FROM campaign.terms_version WHERE campaign_id = ${campaignId}`);
  await owner.execute(sql`DELETE FROM campaign.campaigns WHERE id = ${campaignId}`);
  await app.close();
});

async function put(session: TestSession, url: string, payload: unknown): Promise<void> {
  const response = await app.inject({
    method: "PUT",
    url,
    headers: { cookie: session.cookie },
    payload: payload as object,
  });
  expect(response.statusCode, `${url}: ${response.body}`).toBe(200);
}

/** A person with a row in every table `DELETE /api/me` has to empty. */
async function useEverything(session: TestSession): Promise<{ code: string }> {
  await put(session, "/api/me/interests", { nodeIds: ["coffee"] });
  await put(session, "/api/me/settings/autoplay", { autoplay: "never" });
  await put(session, "/api/me/settings/theme", { theme: "dark" });
  await put(session, "/api/me/notifications/preferences/points_unlocked", { pushEnabled: false });
  const issued = await app.inject({
    method: "POST",
    url: "/api/me/linked-apps/code",
    headers: { cookie: session.cookie, "idempotency-key": randomUUID() },
  });
  expect(issued.statusCode, issued.body).toBe(201);

  const id = session.userId;
  const sessionId = randomUUID();
  await owner.execute(
    sql`INSERT INTO me.follow (user_id, business_id, region) VALUES (${id}, ${randomUUID()}, 'AU')`,
  );
  await owner.execute(
    sql`INSERT INTO me.save (user_id, campaign_id) VALUES (${id}, ${campaignId})`,
  );
  await owner.execute(
    sql`INSERT INTO me.streak_state (user_id, region, current_length) VALUES (${id}, 'AU', 2)`,
  );
  await owner.execute(sql`INSERT INTO me.notification (user_id, region, category, title, body)
    VALUES (${id}, 'AU', 'points_unlocked', 'Points unlocked', '5 pts are now available.')`);
  await owner.execute(sql`INSERT INTO me.voucher_expiry_warning (voucher_id, user_id, region, expires_at)
    VALUES (${randomUUID()}, ${id}, 'AU', now() + interval '3 days')`);
  await owner.execute(
    sql`INSERT INTO feed.demotion (user_id, campaign_id) VALUES (${id}, ${campaignId})`,
  );
  await owner.execute(sql`INSERT INTO identity.verification_token (id, user_id, purpose, expires_at)
    VALUES (${`tok-${randomUUID()}`}, ${id}, 'password_reset', now() + interval '1 hour')`);
  await owner.execute(sql`INSERT INTO identity.principal_security_state (user_id, value_frozen_until)
    VALUES (${id}, now() + interval '1 day')`);
  await owner.execute(sql`INSERT INTO watch.session
    (id, user_id, campaign_id, terms_version, state, started_at, last_progress_at)
    VALUES (${sessionId}, ${id}, ${campaignId}, 1, 'superseded', now(), now())`);
  await owner.execute(sql`INSERT INTO watch.coverage (session_id, from_second, to_second)
    VALUES (${sessionId}, 0, 30)`);
  return { code: issued.json<{ code: string }>().code };
}

async function rowsIn(table: string, id: string): Promise<number> {
  const result = await owner.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM ${sql.raw(table)} WHERE user_id = ${id}`,
  );
  return result.rows[0]?.n ?? 0;
}

async function everyTable(id: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of [...ME_TABLES, "watch.session"]) counts[table] = await rowsIn(table, id);
  return counts;
}

describe("DELETE /api/me erases every personal table", () => {
  it("exports what it will erase, erases it for one person, and leaves the other alone", async () => {
    const leaving = await sessionFor(app, { jurisdiction: "AU" });
    const staying = await sessionFor(app, { jurisdiction: "AU" });
    const { code } = await useEverything(leaving);
    await useEverything(staying);
    const stayingBefore = await everyTable(staying.userId);
    for (const [table, n] of Object.entries(await everyTable(leaving.userId))) {
      expect(n, `${table} was seeded`).toBeGreaterThan(0);
    }

    const exported = await app.inject({
      method: "GET",
      url: "/api/me/data-export",
      headers: { cookie: leaving.cookie },
    });
    expect(exported.statusCode, exported.body).toBe(200);
    const data = exported.json<{
      notifications: { category: string }[];
      settings: {
        autoplay: string | null;
        theme: string | null;
        notificationPreferences: { category: string; pushEnabled: boolean }[];
      };
      showLess: string[];
      linkCodes: { region: string; usedAt: string | null }[];
      voucherExpiryWarnings: unknown[];
      interests: unknown;
      watchSessions: { watchedSpans: { fromSecond: number; toSecond: number }[] }[];
    }>();
    expect(data.notifications.map((n) => n.category)).toEqual(["points_unlocked"]);
    expect(data.settings).toEqual({
      autoplay: "never",
      theme: "dark",
      notificationPreferences: [{ category: "points_unlocked", pushEnabled: false }],
    });
    expect(data.showLess).toEqual([campaignId]);
    expect(data.linkCodes).toHaveLength(1);
    expect(data.voucherExpiryWarnings).toHaveLength(1);
    expect(data.watchSessions[0]?.watchedSpans).toEqual([{ fromSecond: 0, toSecond: 30 }]);
    // The code is a live secret and stays out of the export.
    expect(exported.body).not.toContain(code);

    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/me",
      headers: { cookie: leaving.cookie, "idempotency-key": randomUUID() },
    });
    expect(deleted.statusCode, deleted.body).toBe(200);
    const report = deleted.json<{
      results: { domain: string; outcome: { status: string; records?: number } }[];
    }>();
    expect(report.results.map((r) => r.domain)).toEqual(deletionPlan().map((d) => d.id));
    const outcome = (domain: string) => report.results.find((r) => r.domain === domain)?.outcome;
    // At least what was seeded: registering may add rows of its own (a verification token).
    expect(outcome("me_data")?.status).toBe("erased");
    expect(outcome("me_data")?.records).toBeGreaterThanOrEqual(10);
    expect(outcome("account_security")?.status).toBe("erased");
    expect(outcome("account_security")?.records).toBeGreaterThanOrEqual(2);
    expect(outcome("org_memberships")?.status).toBe("erased");
    // The session and its one coverage span.
    expect(outcome("watch_sessions")?.status).toBe("erased");
    expect(outcome("watch_sessions")?.records).toBeGreaterThanOrEqual(2);

    for (const [table, n] of Object.entries(await everyTable(leaving.userId))) {
      expect(n, `${table} after deletion`).toBe(0);
    }
    expect(await everyTable(staying.userId)).toEqual(stayingBefore);

    const after = await app.inject({
      method: "GET",
      url: "/api/me/consents",
      headers: { cookie: leaving.cookie },
    });
    expect(after.statusCode).toBe(401);
  });
});
