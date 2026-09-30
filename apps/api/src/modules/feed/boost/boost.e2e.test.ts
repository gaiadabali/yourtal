import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../../app.module";
import { createAppDb } from "../../../shared/persistence/drizzle-client";
import { sessionFor } from "../../../shared/testing/session-for";
import { seedBusinessMembership } from "../../../shared/testing/seed-business-membership";

/**
 * 13.23.e Check: two boosted campaigns over HTTP. The higher bid wins the
 * Home slot and pays the lower bid plus one; its spend stops at its daily
 * budget and the slot passes on; the reward rows never change.
 */
let app: NestFastifyApplication;
const db = createAppDb(process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!);

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

/** A live, funded, open-viewing AU campaign owned by a fresh business, seeded by SQL like feed-browse. */
async function liveCampaign(lifecycle: "live" | "draft" = "live") {
  const owner = await sessionFor(app, { jurisdiction: "AU" });
  const businessId = await seedBusinessMembership(db, { userId: owner.userId, role: "owner" });
  const id = randomUUID();
  const media =
    lifecycle === "live"
      ? sql`'https://cdn.example.com/p.jpg', 'https://cdn.example.com/t.mp4', 'https://cdn.example.com/m.m3u8', '9:16', 1000000, 10`
      : sql`NULL, NULL, NULL, NULL, NULL, NULL`;
  await db.execute(sql`
    INSERT INTO campaign.campaigns
      (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds, reward_points,
       question_count, scoring_rule, lifecycle_state, published_at, business_id, region, audience,
       content_category, poster_url, teaser_url, hls_url, aspect, estimated_bytes, estimated_data_mb,
       starts_at, ends_at, open_viewing, teaser_start_seconds)
    VALUES (${id}, 'quick', ${`Boost e2e ${id}`}, ${businessId}, 'Boost e2e', 'Boosted.', 30, 3, 0,
            'base_only', ${lifecycle}, ${lifecycle === "live" ? sql`now()` : sql`NULL`},
            ${businessId}, 'AU', 'all_ages', 'food-and-drink', ${media},
            now() - interval '1 day', now() + interval '30 days', ${lifecycle === "live"}, 0)`);
  if (lifecycle === "live") {
    await db.execute(sql`INSERT INTO campaign.video_source (campaign_id, kind, manifest_url)
      VALUES (${id}, 'hls', 'https://cdn.example.com/m.m3u8')`);
    await db.execute(sql`INSERT INTO campaign.terms_version (campaign_id, version, reward_points,
      question_count, scoring_rule, duration_seconds, accuracy_bonus_points, effective_from)
      VALUES (${id}, 1, 3, 0, 'base_only', 30, 0, now())`);
    const allocationId = randomUUID();
    await db.execute(sql`INSERT INTO platform.ledger_fake_allocation
      (id, business_id, region, funder_type, currency, total_points, remaining_points)
      VALUES (${allocationId}, ${businessId}, 'AU', 'partner', 'AUD', 100000, 100000)`);
    await db.execute(sql`INSERT INTO campaign.reward_config (campaign_id, allocation_id, funder_type,
      max_points_for_campaign, reward_points_per_completion, accuracy_bonus_points)
      VALUES (${id}, ${allocationId}, 'partner', 100000, 3, 0)`);
  }
  return { id, businessId, cookie: owner.cookie };
}

const window = () => ({
  startsAt: new Date(Date.now() - 60_000).toISOString(),
  endsAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
});

async function setBoost(
  c: { id: string; businessId: string; cookie: string },
  dailyBudgetMinor: number,
  maxBidCpmMinor: number,
) {
  return app.inject({
    method: "PUT",
    url: `/api/${c.businessId}/studio/campaigns/${c.id}/boost`,
    headers: { cookie: c.cookie },
    payload: { dailyBudgetMinor, maxBidCpmMinor, ...window() },
  });
}

interface Item {
  campaignId: string;
  boosted: boolean;
  rewardPoints: number;
  maxRewardPoints: number;
}
async function homeFeed(): Promise<Item[]> {
  const response = await app.inject({ method: "GET", url: "/api/feed?region=AU" });
  expect(response.statusCode).toBe(200);
  return response.json<{ items: Item[] }>().items;
}

const rewardRow = async (id: string) =>
  (
    await db.execute(sql`SELECT reward_points_per_completion, accuracy_bonus_points,
      max_points_for_campaign FROM campaign.reward_config WHERE campaign_id = ${id}`)
  ).rows[0];

describe("13.23.e: business boost bids", () => {
  it("refuses a bid under the reserve, a campaign that is not live, and another business's campaign", async () => {
    const live = await liveCampaign();
    expect((await setBoost(live, 100, 99)).json<{ code: string }>().code).toBe("bid_below_reserve");
    const draft = await liveCampaign("draft");
    expect((await setBoost(draft, 100, 500)).json<{ code: string }>().code).toBe(
      "campaign_not_live",
    );
    const stranger = await liveCampaign();
    const crossTenant = await setBoost({ ...live, businessId: stranger.businessId }, 100, 500);
    expect([403, 404]).toContain(crossTenant.statusCode);
  });

  it("the higher bid wins and pays the lower plus one, stops at its budget, and rewards are untouched", async () => {
    const high = await liveCampaign();
    const low = await liveCampaign();
    const rewardsBefore = [await rewardRow(high.id), await rewardRow(low.id)];
    // AUD 0.01 a day buys three impressions at 301 thousandths each (903 of 1,000).
    expect((await setBoost(high, 1, 500)).statusCode).toBe(200);
    expect((await setBoost(low, 10_000, 300)).statusCode).toBe(200);

    for (let round = 0; round < 3; round += 1) {
      const items = await homeFeed();
      expect(items[0]?.campaignId).toBe(high.id);
      expect(items[0]?.boosted).toBe(true);
    }
    const prices = await db.execute(sql`SELECT price_cpm_minor FROM feed.boost_impression
      WHERE campaign_id = ${high.id}`);
    expect(prices.rows.map((row) => Number(row["price_cpm_minor"]))).toEqual([301, 301, 301]);

    // The fourth would take it to 1,204 thousandths: over budget, so the slot passes on.
    const after = await homeFeed();
    expect(after[0]?.campaignId).toBe(low.id);
    expect(after[0]?.boosted).toBe(true);
    const organicHigh = after.find((item) => item.campaignId === high.id);
    expect(organicHigh?.boosted).toBe(false);
    expect(organicHigh?.rewardPoints).toBe(3);

    const spend = await db.execute(sql`SELECT impressions, spent_milli FROM feed.boost_spend_day
      WHERE campaign_id = ${high.id}`);
    expect(spend.rows).toEqual([{ impressions: 3, spent_milli: "903" }]);

    const view = await app.inject({
      method: "GET",
      url: `/api/${high.businessId}/studio/campaigns/${high.id}/boost`,
      headers: { cookie: high.cookie },
    });
    expect(view.json()).toMatchObject({
      currency: "AUD",
      impressions: 3,
      spendMinor: 1,
      averageCpmMinor: 301,
      reserveCpmMinor: 100,
    });
    expect([await rewardRow(high.id), await rewardRow(low.id)]).toEqual(rewardsBefore);
  });
});
