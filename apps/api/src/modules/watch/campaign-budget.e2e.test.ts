import { randomUUID } from "node:crypto";
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
 * 14.2's Check over the real HTTP stack (real Nest app, Cerbos, Postgres, the
 * fake-mode ledger): a campaign's total budget and daily cap stop rewards,
 * the viewer refused is told why at session start, and the feed shows a
 * district-targeted campaign only in its districts. 30-second campaigns ask
 * no questions, so a full progress report completes a session.
 */
const owner: AppDb = createAppDb(process.env["DATABASE_OWNER_URL"] ?? "");
let app: NestFastifyApplication;

const DURATION = 30;
const REWARD = 100;
const allocationId = randomUUID();
const businessId = randomUUID();
const budgetCampaign = randomUUID(); // a budget of exactly one completion
const cappedCampaign = randomUUID(); // a daily cap of one completion
const targetedCampaign = randomUUID(); // shown in postcode 2026 (Bondi) only
const campaignIds = [budgetCampaign, cappedCampaign, targetedCampaign];

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- a narrow, per-call-site type instead of `any` from `.json()`.
function json<T>(response: { json: () => unknown }): T {
  return response.json() as T;
}

async function seedCampaign(
  id: string,
  budget: { max: number; dailyCap: number | null; districts: string[] },
): Promise<void> {
  await owner.execute(sql`
    INSERT INTO campaign.campaigns
      (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
       estimated_data_mb, reward_points, question_count, scoring_rule,
       lifecycle_state, published_at, business_id, region, audience, content_category,
       poster_url, teaser_url, hls_url, aspect, estimated_bytes,
       starts_at, ends_at, open_viewing, teaser_start_seconds, target_districts)
    VALUES
      (${id}, 'quick', '14.2 budget fixture', ${randomUUID()}, 'budget merchant',
       'fixture', ${DURATION}, 5, ${REWARD}, 0, 'base_only',
       'live', now(), ${businessId}, 'AU', 'all_ages', 'entertainment',
       'https://example.test/poster.jpg', 'https://example.test/teaser.m3u8',
       'https://example.test/hls.m3u8', '16:9', 1000000,
       now() - interval '1 hour', now() + interval '30 days', false, 0,
       ${JSON.stringify(budget.districts)}::jsonb)
  `);
  await owner.execute(sql`
    INSERT INTO campaign.terms_version
      (campaign_id, version, reward_points, question_count, scoring_rule, duration_seconds, accuracy_bonus_points, effective_from)
    VALUES (${id}, 1, ${REWARD}, 0, 'base_only', ${DURATION}, 0, now())
  `);
  await owner.execute(sql`
    INSERT INTO campaign.video_source (campaign_id, kind, manifest_url)
    VALUES (${id}, 'hls', 'https://example.test/hls.m3u8')
  `);
  await owner.execute(sql`
    INSERT INTO campaign.reward_config
      (campaign_id, allocation_id, funder_type, max_points_for_campaign,
       reward_points_per_completion, accuracy_bonus_points, daily_cap_points)
    VALUES (${id}, ${allocationId}, 'partner', ${budget.max}, ${REWARD}, 0, ${budget.dailyCap})
  `);
}

beforeAll(async () => {
  await owner.execute(sql`
    INSERT INTO platform.ledger_fake_allocation (id, business_id, region, funder_type, currency, total_points, remaining_points)
    VALUES (${allocationId}, ${businessId}, 'AU', 'partner', 'AUD', 1000000, 1000000)
  `);
  await seedCampaign(budgetCampaign, { max: REWARD, dailyCap: null, districts: [] });
  await seedCampaign(cappedCampaign, { max: 100 * REWARD, dailyCap: REWARD, districts: [] });
  await seedCampaign(targetedCampaign, { max: 100 * REWARD, dailyCap: null, districts: ["2026"] });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
  await owner.execute(
    sql`DELETE FROM platform.ledger_fake_hold WHERE allocation_id = ${allocationId}`,
  );
  await owner.execute(
    sql`DELETE FROM platform.ledger_fake_grant WHERE campaign_id IN ${campaignIds}`,
  );
  await owner.execute(sql`DELETE FROM watch.session WHERE campaign_id IN ${campaignIds}`);
  await owner.execute(sql`DELETE FROM campaign.reward_config WHERE campaign_id IN ${campaignIds}`);
  await owner.execute(sql`DELETE FROM campaign.terms_version WHERE campaign_id IN ${campaignIds}`);
  await owner.execute(sql`DELETE FROM campaign.video_source WHERE campaign_id IN ${campaignIds}`);
  await owner.execute(sql`DELETE FROM campaign.campaigns WHERE id IN ${campaignIds}`);
  await owner.execute(sql`DELETE FROM platform.ledger_fake_allocation WHERE id = ${allocationId}`);
});

interface Started {
  session: { id: string; nonEarning: boolean; nonEarningReason: string | null };
}

async function start(cookie: string, campaignId: string): Promise<Started["session"]> {
  const response = await app.inject({
    method: "POST",
    url: "/api/watch/sessions",
    headers: { cookie, "idempotency-key": randomUUID() },
    payload: { campaignId },
  });
  expect(response.statusCode).toBe(201);
  return json<Started>(response).session;
}

async function watchAndComplete(cookie: string, sessionId: string) {
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
  const complete = await app.inject({
    method: "POST",
    url: `/api/watch/sessions/${sessionId}/complete`,
    headers: { cookie, "idempotency-key": randomUUID() },
  });
  expect(complete.statusCode).toBe(201);
  return json<{ granted: boolean; pendingPoints: number; reason?: string | null }>(complete);
}

async function feedIds(cookie: string, query = ""): Promise<string[]> {
  const response = await app.inject({
    method: "GET",
    url: `/api/feed${query}`,
    headers: { cookie },
  });
  expect(response.statusCode).toBe(200);
  return json<{ items: { campaignId: string }[] }>(response).items.map((item) => item.campaignId);
}

describe("14.2: the total budget", () => {
  it("pays the session admitted first, tells the next viewer up front, and leaves the feed", async () => {
    const first = await sessionFor(app);
    const second = await sessionFor(app);
    expect(await feedIds(second.cookie)).toContain(budgetCampaign);

    const earning = await start(first.cookie, budgetCampaign);
    expect(earning.nonEarning).toBe(false);
    // The first session's hold reserves the whole budget: the next viewer is
    // told before watching, not refused at the end.
    const refused = await start(second.cookie, budgetCampaign);
    expect(refused.nonEarning).toBe(true);
    expect(refused.nonEarningReason).toBe("This campaign has given out all its rewards.");
    expect(await feedIds(second.cookie)).not.toContain(budgetCampaign);

    const paid = await watchAndComplete(first.cookie, earning.id);
    expect(paid).toMatchObject({ granted: true, pendingPoints: REWARD });
    const holds = await owner.execute<{ state: string }>(sql`
      SELECT h.state FROM platform.ledger_fake_hold h
        JOIN watch.session s ON s.hold_id = h.id WHERE s.id = ${earning.id}
    `);
    expect(holds.rows[0]?.state).toBe("consumed");

    const unpaid = await watchAndComplete(second.cookie, refused.id);
    expect(unpaid).toMatchObject({ granted: false, pendingPoints: 0 });
    expect(unpaid.reason).toBe("This campaign has given out all its rewards.");
  });
});

describe("14.2: the daily cap", () => {
  it("stops new sessions for the rest of the day once today's cap is held or paid", async () => {
    const first = await sessionFor(app);
    const second = await sessionFor(app);
    expect((await start(first.cookie, cappedCampaign)).nonEarning).toBe(false);
    const refused = await start(second.cookie, cappedCampaign);
    expect(refused.nonEarning).toBe(true);
    expect(refused.nonEarningReason).toBe(
      "This campaign has given out today's rewards. You can earn from it again tomorrow.",
    );
    expect(await feedIds(second.cookie)).not.toContain(cappedCampaign);
  });
});

describe("14.2: district targeting in the feed", () => {
  it("shows a targeted campaign only in its districts, and never without one", async () => {
    const viewer = await sessionFor(app);
    expect(await feedIds(viewer.cookie)).not.toContain(targetedCampaign);
    expect(await feedIds(viewer.cookie, "?district=%202026%20")).toContain(targetedCampaign);
    expect(await feedIds(viewer.cookie, "?district=2095")).not.toContain(targetedCampaign);
  });

  it("uses the viewer's declared area when no district is sent, and an explicit district wins", async () => {
    const viewer = await sessionFor(app);
    const set = (postcode: string) =>
      app.inject({
        method: "PUT",
        url: "/api/me/settings/area",
        headers: { cookie: viewer.cookie },
        payload: { postcode },
      });
    expect((await set("2026")).statusCode).toBe(200);
    expect(await feedIds(viewer.cookie)).toContain(targetedCampaign);
    // An explicit ?district= for somewhere else wins over the declared area.
    expect(await feedIds(viewer.cookie, "?district=2095")).not.toContain(targetedCampaign);

    expect((await set("2095")).statusCode).toBe(200);
    expect(await feedIds(viewer.cookie)).not.toContain(targetedCampaign);

    const cleared = await app.inject({
      method: "DELETE",
      url: "/api/me/settings/area",
      headers: { cookie: viewer.cookie },
    });
    expect(cleared.statusCode).toBe(200);
    expect(await feedIds(viewer.cookie)).not.toContain(targetedCampaign);
  });

  it("never shows a targeted campaign to a viewer in the other region, whatever their area", async () => {
    const indonesian = await sessionFor(app, { jurisdiction: "ID" });
    expect(await feedIds(indonesian.cookie)).not.toContain(targetedCampaign);
  });
});
