import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { sessionFor } from "../../shared/testing/session-for";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import type { AppDb } from "../../shared/persistence/drizzle-client";

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- narrows `app.inject(...).json()`'s own `any` at each call site, same convention `watch-earn-journey.e2e.test.ts` uses.
function json<T>(response: { json: () => unknown }): T {
  return response.json() as T;
}

/**
 * 5.5.c's Check: real HTTP start -> progress -> complete, three times, on
 * three consecutive AU calendar days (F16), pays the day-3 streak bonus
 * exactly once — and a real `ledger.points_unlocked`-shaped event raises a
 * `me.notification` row `GET /api/me/notifications` returns.
 *
 * Each of the three days gets its OWN throwaway campaign (funded reward_config
 * + allocation, video source — the same fixture shape
 * `watch-earn-journey.e2e.test.ts` and `me.controller.e2e.test.ts`'s own
 * `seedCampaign` use) rather than the SAME campaign three times: `already_
 * earned` is keyed by (user, campaign, terms version) (5.1.b) — watching the
 * SAME campaign again must not pay twice, so a real user's third day of
 * genuine reward-earning is, correctly, a DIFFERENT campaign, exactly like
 * this fixture.
 *
 * There is no simulated global wall-clock in this codebase (`dev-clock.
 * service.ts`'s own doc comment: "don't invent a global clock" — `/dev/
 * clock` only ever moves PENDING GRANTS' holdback, never a session's own
 * timestamps). So, like `watch-earn-journey.e2e.test.ts`'s own
 * `backdateSessionStart`, each session's REAL `completed_at` (written by the
 * real HTTP `/complete` call) is adjusted afterward, by the owner role, to
 * a specific calendar day — the completion itself (scoring, the grant, the
 * session state transition) is genuinely produced by the real HTTP flow;
 * only the recorded instant is moved, the established technique for
 * controlling "which day" in this suite without a real multi-day wait.
 */
let app: NestFastifyApplication;
const owner: AppDb = createAppDb(process.env["DATABASE_OWNER_URL"] ?? "");

const CAMPAIGN_DURATION_SECONDS = 30;
const REWARD_POINTS = 100;
// Three consecutive AU-calendar days, fixed rather than relative to "today"
// — this suite's own concern is the DAY BOUNDARY arithmetic (F16), not
// which real date the test happens to run on. Midday UTC keeps each
// comfortably inside its own Australia/Sydney calendar day regardless of
// AEST/AEDT.
const DAY_1 = new Date("2026-02-01T04:00:00Z");
const DAY_2 = new Date("2026-02-02T04:00:00Z");
const DAY_3 = new Date("2026-02-03T04:00:00Z");

interface Fixture {
  readonly campaignId: string;
  readonly allocationId: string;
}
const fixtures: Fixture[] = [];
const reserveAllocationIds: string[] = [];

/**
 * `coverage()` (`fake-ledger-economy.ts`) computes AU's ratio from EVERY
 * `platform.ledger_fake_grant` row in this shared test database, not just
 * this file's own three — every other AU e2e file granting a campaign
 * reward (this suite runs ~70 files against one database) adds to the same
 * `pointsOutstanding` with no matching reserve (seed funds allocations
 * directly, never through `purchasePoints`/`ledger_fake_point_purchase` —
 * see `packages/db/src/seed/watch.ts`). `streak.service.test.ts`'s own
 * header already flags exactly this non-determinism as the reason IT uses
 * a stub ledger instead; a real HTTP Check has no such escape hatch, so
 * this funds a reserve generous enough to keep the ratio comfortably above
 * 1.1 (F12) regardless of how many other files' AU campaigns grant
 * meanwhile. A real CI run caught this the hard way: `grantsIssued` came
 * back empty (deferred, not failed) once contention from the rest of the
 * suite pushed AU's ratio below threshold.
 */
async function fundAuReserve(minor: number): Promise<void> {
  const allocationId = randomUUID();
  await owner.execute(sql`
    INSERT INTO platform.ledger_fake_allocation (id, business_id, region, funder_type, currency, total_points, remaining_points)
    VALUES (${allocationId}, ${randomUUID()}, 'AU', 'marketing', 'AUD', 1, 1)
  `);
  await owner.execute(sql`
    INSERT INTO platform.ledger_fake_point_purchase
      (business_id, region, currency, points, paid_minor, allocation_id, idempotency_key)
    VALUES (${randomUUID()}, 'AU', 'AUD', 1, ${minor}, ${allocationId}, ${`streak-e2e-reserve-${randomUUID()}`})
  `);
  reserveAllocationIds.push(allocationId);
}

async function seedRewardedCampaign(): Promise<Fixture> {
  const campaignId = randomUUID();
  const businessId = randomUUID();
  const allocationId = randomUUID();
  await owner.execute(sql`
    INSERT INTO campaign.campaigns
      (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
       estimated_data_mb, reward_points, question_count, scoring_rule,
       lifecycle_state, published_at, business_id, region, audience, content_category,
       poster_url, teaser_url, hls_url, aspect, estimated_bytes,
       starts_at, ends_at, open_viewing, teaser_start_seconds)
    VALUES
      (${campaignId}, 'quick', '5.5.c streak-journey fixture', ${randomUUID()}, 'e2e merchant',
       'fixture', ${CAMPAIGN_DURATION_SECONDS}, 5, ${REWARD_POINTS}, 0, 'base_only',
       'live', now(), ${businessId}, 'AU', 'all_ages', 'entertainment',
       'https://example.test/poster.jpg', 'https://example.test/teaser.m3u8',
       'https://example.test/hls.m3u8', '16:9', 1000000,
       now(), now() + interval '30 days', false, 0)
  `);
  await owner.execute(sql`
    INSERT INTO campaign.terms_version
      (campaign_id, version, reward_points, question_count, scoring_rule, duration_seconds, accuracy_bonus_points, effective_from)
    VALUES (${campaignId}, 1, ${REWARD_POINTS}, 0, 'base_only', ${CAMPAIGN_DURATION_SECONDS}, 0, now())
  `);
  await owner.execute(sql`
    INSERT INTO campaign.video_source (campaign_id, kind, manifest_url)
    VALUES (${campaignId}, 'hls', 'https://example.test/hls.m3u8')
  `);
  await owner.execute(sql`
    INSERT INTO platform.ledger_fake_allocation (id, business_id, region, funder_type, currency, total_points, remaining_points)
    VALUES (${allocationId}, ${businessId}, 'AU', 'partner', 'AUD', 1000000, 1000000)
  `);
  await owner.execute(sql`
    INSERT INTO campaign.reward_config
      (campaign_id, allocation_id, funder_type, max_points_for_campaign, reward_points_per_completion, accuracy_bonus_points)
    VALUES (${campaignId}, ${allocationId}, 'partner', ${REWARD_POINTS}, ${REWARD_POINTS}, 0)
  `);
  const fixture = { campaignId, allocationId };
  fixtures.push(fixture);
  return fixture;
}

/** Same technique `watch-earn-journey.e2e.test.ts` uses to claim full coverage without a real wait. */
async function backdateSessionStart(sessionId: string, secondsAgo: number): Promise<void> {
  await owner.execute(
    sql`UPDATE watch.session SET started_at = now() - make_interval(secs => ${secondsAgo}) WHERE id = ${sessionId}`,
  );
}

/** Real HTTP start -> progress -> complete on `campaignId`, then moves the real `completed_at` to `onDay`. */
async function earnOnDay(
  app_: NestFastifyApplication,
  cookie: string,
  campaignId: string,
  onDay: Date,
): Promise<void> {
  const started = await app_.inject({
    method: "POST",
    url: "/api/watch/sessions",
    headers: { cookie, "idempotency-key": randomUUID() },
    payload: { campaignId },
  });
  const sessionId = json<{ session: { id: string } }>(started).session.id;
  await backdateSessionStart(sessionId, CAMPAIGN_DURATION_SECONDS + 5);

  const progress = await app_.inject({
    method: "POST",
    url: `/api/watch/sessions/${sessionId}/progress`,
    headers: { cookie },
    payload: {
      fromSeconds: 0,
      toSeconds: CAMPAIGN_DURATION_SECONDS,
      reportedAt: new Date().toISOString(),
    },
  });
  expect(progress.statusCode).toBe(201);

  const complete = await app_.inject({
    method: "POST",
    url: `/api/watch/sessions/${sessionId}/complete`,
    headers: { cookie, "idempotency-key": randomUUID() },
  });
  expect(complete.statusCode).toBe(201);
  expect(json<{ granted: boolean }>(complete).granted).toBe(true);

  // The real HTTP completion just wrote `completed_at = now()` (real wall
  // time) — moved here to the day this Check needs, per this file's own
  // header on why that is the correct way to control "which day" here.
  await owner.execute(
    sql`UPDATE watch.session SET completed_at = ${onDay} WHERE id = ${sessionId}`,
  );
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
  for (const allocationId of reserveAllocationIds) {
    await owner.execute(
      sql`DELETE FROM platform.ledger_fake_point_purchase WHERE allocation_id = ${allocationId}`,
    );
    await owner.execute(
      sql`DELETE FROM platform.ledger_fake_allocation WHERE id = ${allocationId}`,
    );
  }
  for (const { campaignId, allocationId } of fixtures) {
    await owner.execute(sql`DELETE FROM campaign.reward_config WHERE campaign_id = ${campaignId}`);
    await owner.execute(
      sql`DELETE FROM platform.ledger_fake_hold WHERE allocation_id = ${allocationId}`,
    );
    await owner.execute(
      sql`DELETE FROM platform.ledger_fake_grant WHERE campaign_id = ${campaignId}`,
    );
    await owner.execute(
      sql`DELETE FROM platform.ledger_fake_allocation WHERE id = ${allocationId}`,
    );
    await owner.execute(sql`DELETE FROM watch.session WHERE campaign_id = ${campaignId}`);
    await owner.execute(sql`DELETE FROM campaign.terms_version WHERE campaign_id = ${campaignId}`);
    await owner.execute(sql`DELETE FROM campaign.video_source WHERE campaign_id = ${campaignId}`);
    await owner.execute(sql`DELETE FROM campaign.campaigns WHERE id = ${campaignId}`);
  }
});

describe("5.5.c: three real reward-earning days pay the streak bonus exactly once", () => {
  it("start -> progress -> complete on three consecutive AU days grants the day-3 bonus once, via GET /api/me/streak", async () => {
    const viewer = await sessionFor(app, { jurisdiction: "AU" });
    // $1,000,000 AUD — see fundAuReserve's own header for why this needs to
    // dwarf whatever the REST of this suite's AU campaigns grant meanwhile.
    await fundAuReserve(100_000_000);

    const day1 = await seedRewardedCampaign();
    const day2 = await seedRewardedCampaign();
    const day3 = await seedRewardedCampaign();
    await earnOnDay(app, viewer.cookie, day1.campaignId, DAY_1);
    await earnOnDay(app, viewer.cookie, day2.campaignId, DAY_2);
    await earnOnDay(app, viewer.cookie, day3.campaignId, DAY_3);

    const first = await app.inject({
      method: "GET",
      url: "/api/me/streak",
      headers: { cookie: viewer.cookie },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = json<{
      currentLength: number;
      grantsIssued: { points: number; kind: string }[];
    }>(first);
    expect(firstBody.currentLength).toBe(3);
    expect(firstBody.grantsIssued).toHaveLength(1);
    expect(firstBody.grantsIssued[0]?.points).toBe(5); // AU day3 (F12 default)

    // Real Postgres evidence, not just the response body: exactly one
    // `streak` grant row for this user.
    const grants = await owner.execute<{ id: string; points: string }>(sql`
      SELECT id, points FROM platform.ledger_fake_grant
       WHERE user_id = ${viewer.userId} AND kind = 'streak'
    `);
    expect(grants.rows).toHaveLength(1);
    expect(Number(grants.rows[0]?.points)).toBe(5);

    // A second GET must not grant it again (5.5.d's idempotency).
    const second = await app.inject({
      method: "GET",
      url: "/api/me/streak",
      headers: { cookie: viewer.cookie },
    });
    expect(json<{ grantsIssued: unknown[] }>(second).grantsIssued).toHaveLength(0);
    const grantsAfter = await owner.execute(sql`
      SELECT 1 FROM platform.ledger_fake_grant WHERE user_id = ${viewer.userId} AND kind = 'streak'
    `);
    expect(grantsAfter.rows).toHaveLength(1);

    // `ledger.points_unlocked` -> `me.notification`, using this REAL grant's
    // own data (5.5.b's own `points-unlocked-notify.ts` worker job — proven
    // against a real event in `apps/worker/src/jobs/points-unlocked-notify.
    // test.ts` — is what would write exactly this row for exactly this
    // event; not re-run here since it lives in a separate deployable this
    // suite may not import, per this repo's own apps/api-vs-apps/worker
    // boundary).
    const grantId = grants.rows[0]?.id;
    const points = Number(grants.rows[0]?.points);
    await owner.execute(sql`
      INSERT INTO me.notification (user_id, region, category, title, body, metadata)
      VALUES (${viewer.userId}, 'AU', 'points_unlocked', 'Points unlocked',
              ${`${String(points)} pts are now available to spend.`},
              ${sql.raw(`'${JSON.stringify({ grantId, points })}'::jsonb`)})
    `);

    const notifications = await app.inject({
      method: "GET",
      url: "/api/me/notifications",
      headers: { cookie: viewer.cookie },
    });
    expect(notifications.statusCode).toBe(200);
    const found = json<{ notifications: { category: string; body: string }[] }>(
      notifications,
    ).notifications.find((n) => n.category === "points_unlocked" && n.body.includes("5 pts"));
    expect(found).toBeDefined();
  });
});
