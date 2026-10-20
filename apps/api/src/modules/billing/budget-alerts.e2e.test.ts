import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toPoints } from "@yourtal/contracts/money";
import { AppModule } from "../../app.module";
import { LEDGER_INTERNAL_CLIENT } from "../../shared/ledger-client/ledger-internal-client";
import type { LedgerInternalClient } from "../../shared/ledger-client/ledger-internal-client";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { seedBusinessMembership } from "../../shared/testing/seed-business-membership";
import { sessionFor } from "../../shared/testing/session-for";
import { BudgetAlertsService } from "./alerts/budget-alerts.service";

/**
 * 14.13.b's Check over the real HTTP stack (Nest, Cerbos, Postgres, the
 * fake-mode ledger): a package and a campaign budget each raise one alert
 * at 50%, 80% and 100%, emailed once to the owner and finance; a re-run
 * sends nothing again; and at 100% rewards stop without an error, the next
 * viewer told before watching. 30-second campaigns ask no questions.
 */
const owner: AppDb = createAppDb(process.env["DATABASE_OWNER_URL"] ?? "");
const db = createAppDb(process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!);
let app: NestFastifyApplication;
let ledger: LedgerInternalClient;
let alerts: BudgetAlertsService;

const DURATION = 30;
const REWARD = 100;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  ledger = app.get(LEDGER_INTERNAL_CLIENT, { strict: false });
  alerts = app.get(BudgetAlertsService, { strict: false });
});

afterAll(async () => {
  await app.close();
});

/** A business with an owner and a finance member, both with verified emails. */
async function business() {
  const ownerSession = await sessionFor(app, { jurisdiction: "AU" });
  const finance = await sessionFor(app, { jurisdiction: "AU" });
  const businessId = await seedBusinessMembership(db, { userId: ownerSession.userId, role: "owner" });
  await owner.execute(sql`
    INSERT INTO business.business_members (business_id, user_id, role, invited_by_user_id, joined_at)
    VALUES (${businessId}, ${finance.userId}, 'finance', ${ownerSession.userId}, now())`);
  await owner.execute(sql`
    UPDATE identity.credential SET verified_at = coalesce(verified_at, now())
     WHERE user_id IN (${ownerSession.userId}, ${finance.userId})`);
  return { businessId, cookie: ownerSession.cookie, emails: [ownerSession.email, finance.email] };
}

async function liveCampaign(businessId: string, allocationId: string, budget: number) {
  const id = randomUUID();
  await owner.execute(sql`
    INSERT INTO campaign.campaigns
      (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
       estimated_data_mb, reward_points, question_count, scoring_rule,
       lifecycle_state, published_at, business_id, region, audience, content_category,
       poster_url, teaser_url, hls_url, aspect, estimated_bytes,
       starts_at, ends_at, open_viewing, teaser_start_seconds)
    VALUES
      (${id}, 'quick', 'Spring launch', ${randomUUID()}, 'alerts merchant', 'fixture', ${DURATION},
       5, ${REWARD}, 0, 'base_only', 'live', now(), ${businessId}, 'AU', 'all_ages', 'entertainment',
       'https://example.test/poster.jpg', 'https://example.test/teaser.m3u8',
       'https://example.test/hls.m3u8', '16:9', 1000000,
       now() - interval '1 hour', now() + interval '30 days', false, 0)`);
  await owner.execute(sql`
    INSERT INTO campaign.terms_version
      (campaign_id, version, reward_points, question_count, scoring_rule, duration_seconds, accuracy_bonus_points, effective_from)
    VALUES (${id}, 1, ${REWARD}, 0, 'base_only', ${DURATION}, 0, now())`);
  await owner.execute(sql`
    INSERT INTO campaign.video_source (campaign_id, kind, manifest_url)
    VALUES (${id}, 'hls', 'https://example.test/hls.m3u8')`);
  await owner.execute(sql`
    INSERT INTO campaign.reward_config
      (campaign_id, allocation_id, funder_type, max_points_for_campaign,
       reward_points_per_completion, accuracy_bonus_points)
    VALUES (${id}, ${allocationId}, 'partner', ${budget}, ${REWARD}, 0)`);
  return id;
}

async function hold(allocationId: string, campaignId: string, points: number) {
  return ledger.hold({ allocationId, points: toPoints(points), sagaId: randomUUID(), campaignId });
}

async function alertRows(businessId: string) {
  const { rows } = await db.execute<{ subject_kind: string; threshold_pct: number }>(sql`
    SELECT subject_kind, threshold_pct FROM payment.budget_alert
     WHERE business_id = ${businessId} ORDER BY subject_kind, threshold_pct`);
  return rows.map((row) => `${row.subject_kind}:${String(row.threshold_pct)}`);
}

async function emailsTo(addresses: readonly string[]) {
  const { rows } = await db.execute<{ recipient: string; subject: string }>(sql`
    SELECT recipient, subject FROM platform.sim_outbox
     WHERE boundary = 'email' AND category = 'budget_alert' AND recipient IN (${sql.join(
       addresses.map((address) => sql`${address}`),
       sql`, `,
     )})
     ORDER BY created_at, recipient`);
  return rows;
}

async function startSession(cookie: string, campaignId: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/watch/sessions",
    headers: { cookie, "idempotency-key": randomUUID() },
    payload: { campaignId },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ session: { id: string; nonEarning: boolean; nonEarningReason: string | null } }>()
    .session;
}

async function complete(cookie: string, sessionId: string) {
  await owner.execute(
    sql`UPDATE watch.session SET started_at = now() - make_interval(secs => ${DURATION + 5}) WHERE id = ${sessionId}`,
  );
  const progress = await app.inject({
    method: "POST",
    url: `/api/watch/sessions/${sessionId}/progress`,
    headers: { cookie },
    payload: { fromSeconds: 0, toSeconds: DURATION, reportedAt: new Date().toISOString() },
  });
  expect(progress.statusCode).toBe(201);
  const done = await app.inject({
    method: "POST",
    url: `/api/watch/sessions/${sessionId}/complete`,
    headers: { cookie, "idempotency-key": randomUUID() },
  });
  expect(done.statusCode).toBe(201);
  return done.json<{ granted: boolean; pendingPoints: number }>();
}

async function feedIds(cookie: string): Promise<string[]> {
  const response = await app.inject({ method: "GET", url: "/api/feed", headers: { cookie } });
  expect(response.statusCode).toBe(200);
  return response.json<{ items: { campaignId: string }[] }>().items.map((item) => item.campaignId);
}

describe("14.13.b: a package's alerts, and rewards stopping at 100%", () => {
  it("alerts once at 50, 80 and 100%, then the campaign stops earning gracefully", async () => {
    const biz = await business();
    const bought = await app.inject({
      method: "POST",
      url: `/api/${biz.businessId}/studio/billing/purchases`,
      headers: { cookie: biz.cookie, "idempotency-key": `test-${randomUUID()}` },
      payload: { tierKey: "starter", currency: "AUD" },
    });
    expect(bought.statusCode).toBe(201);
    const allocationId = bought.json<{ allocation: { allocationId: string } }>().allocation
      .allocationId;
    // The budget is larger than the package, so the package is what runs out.
    const campaignId = await liveCampaign(biz.businessId, allocationId, 2_000);

    expect((await hold(allocationId, campaignId, 500)).isOk()).toBe(true);
    await alerts.sweep();
    expect(await alertRows(biz.businessId)).toEqual(["package:50"]);
    expect(await emailsTo(biz.emails)).toHaveLength(2);
    await alerts.sweep();
    expect(await emailsTo(biz.emails)).toHaveLength(2);

    expect((await hold(allocationId, campaignId, 300)).isOk()).toBe(true);
    await alerts.sweep();
    expect(await alertRows(biz.businessId)).toEqual(["package:50", "package:80"]);

    // The last 200 points: two viewers each hold one session's reward.
    const first = await sessionFor(app);
    const second = await sessionFor(app);
    const third = await sessionFor(app);
    const paid = await startSession(first.cookie, campaignId);
    expect((await startSession(second.cookie, campaignId)).nonEarning).toBe(false);
    expect(paid.nonEarning).toBe(false);
    // Used up: the campaign leaves the feed, and a viewer who opens it is told first.
    expect(await feedIds(third.cookie)).not.toContain(campaignId);
    const refused = await startSession(third.cookie, campaignId);
    expect(refused).toMatchObject({
      nonEarning: true,
      nonEarningReason: "This campaign has run out of funding right now.",
    });
    expect((await hold(allocationId, campaignId, 1))._unsafeUnwrapErr().code).toBe(
      "allocation_exhausted",
    );

    await alerts.sweep();
    expect(await alertRows(biz.businessId)).toEqual([
      "campaign:50",
      "package:50",
      "package:80",
      "package:100",
    ]);
    expect((await emailsTo(biz.emails)).map((email) => email.subject)).toContain(
      "Your points package is used up",
    );

    // The admitted viewer is paid; the refused one earns nothing and nothing fails.
    expect(await complete(first.cookie, paid.id)).toMatchObject({ granted: true, pendingPoints: REWARD });
    expect(await complete(third.cookie, refused.id)).toMatchObject({ granted: false, pendingPoints: 0 });

    const listed = await app.inject({
      method: "GET",
      url: `/api/${biz.businessId}/studio/billing/alerts`,
      headers: { cookie: biz.cookie },
    });
    expect(listed.statusCode).toBe(200);
    const body = listed.json<{ alerts: { kind: string; thresholdPct: number; campaignTitle: string | null }[] }>();
    expect(body.alerts).toHaveLength(4);
    expect(body.alerts.find((a) => a.kind === "campaign")?.campaignTitle).toBe("Spring launch");
    // One email per subject per sweep that found something new, to each of
    // the two recipients: package 50, package 80, then package 100 and campaign 50.
    expect(await emailsTo(biz.emails)).toHaveLength(8);
  });
});

describe("14.13.b: a campaign budget's alerts", () => {
  async function fundedCampaign(budget: number) {
    const biz = await business();
    const allocationId = randomUUID();
    await owner.execute(sql`
      INSERT INTO platform.ledger_fake_allocation (id, business_id, region, funder_type, currency, total_points, remaining_points)
      VALUES (${allocationId}, ${biz.businessId}, 'AU', 'partner', 'AUD', 1000000, 1000000)`);
    return { biz, allocationId, campaignId: await liveCampaign(biz.businessId, allocationId, budget) };
  }

  it("alerts once at each threshold, and at 100% refuses the next session's hold", async () => {
    const { biz, allocationId, campaignId } = await fundedCampaign(1_000);
    for (const [points, expected] of [
      [500, ["campaign:50"]],
      [400, ["campaign:50", "campaign:80"]],
      [100, ["campaign:50", "campaign:80", "campaign:100"]],
    ] as const) {
      expect((await hold(allocationId, campaignId, points)).isOk()).toBe(true);
      await alerts.sweep();
      await alerts.sweep();
      expect(await alertRows(biz.businessId)).toEqual(expected);
    }
    expect(await emailsTo(biz.emails)).toHaveLength(6);
    expect((await hold(allocationId, campaignId, REWARD))._unsafeUnwrapErr().code).toBe(
      "campaign_cap_reached",
    );
  });

  it("a budget spent in one go raises all three but sends one email per person", async () => {
    const { biz, allocationId, campaignId } = await fundedCampaign(200);
    expect((await hold(allocationId, campaignId, 200)).isOk()).toBe(true);
    await alerts.sweep();
    expect(await alertRows(biz.businessId)).toEqual(["campaign:50", "campaign:80", "campaign:100"]);
    const sent = await emailsTo(biz.emails);
    expect(sent).toHaveLength(2);
    expect(sent[0]?.subject).toBe('Campaign "Spring launch" has used its whole budget');
  });
});
