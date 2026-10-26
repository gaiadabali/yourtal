import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { OWNER_URL } from "../database-urls";
import { retireLeakedFixtures } from "./retire-leaked-fixtures";

/** The deploy-time retirement of what test runs left live, against real Postgres. */
const { Pool } = pg;
let owner: pg.Pool;
const quiet = () => undefined;
const campaignIds: string[] = [];
const listingIds: string[] = [];

beforeAll(() => {
  owner = new Pool({ connectionString: OWNER_URL, max: 2 });
});
afterAll(async () => {
  await owner.query(`DELETE FROM campaign.campaigns WHERE id = ANY($1)`, [campaignIds]);
  await owner.query(`DELETE FROM store.listings WHERE id = ANY($1)`, [listingIds]);
  await owner.end();
});

async function liveCampaign(title: string, state: "live" | "in_review" = "live"): Promise<string> {
  const id = randomUUID();
  campaignIds.push(id);
  await owner.query(
    `INSERT INTO campaign.campaigns
       (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
        estimated_data_mb, reward_points, question_count, scoring_rule,
        lifecycle_state, published_at, business_id, region, audience, content_category,
        poster_url, teaser_url, hls_url, aspect, estimated_bytes,
        starts_at, ends_at, open_viewing, teaser_start_seconds)
     VALUES ($1, 'quick', $2, $3, 'Snap App', 'fixture', 30, 5, 100, 0, 'base_only',
        $4, CASE WHEN $4 = 'live' THEN now() END, $3, 'AU', 'all_ages', 'entertainment',
        'https://example.test/p.jpg', 'https://example.test/t.m3u8',
        'https://example.test/h.m3u8', '16:9', 1000000,
        now(), now() + interval '30 days', true, 0)`,
    [id, title, randomUUID(), state],
  );
  return id;
}

async function listing(title: string): Promise<string> {
  const id = randomUUID();
  const business = randomUUID();
  listingIds.push(id);
  await owner.query(
    `INSERT INTO store.listings (id, merchant_id, merchant_name, title, description, category,
       face_value_minor, settlement_value_minor, price_in_points, stock_remaining, stock_total,
       transferable, partial_redemption_policy, minimum_spend_minor, expires_at, status, currency,
       region, audience, content_category, image_url, channel, partial_redemption)
     VALUES ($1, $2, 'Snap App', $3, 'fixture', 'food-and-drink', 1000, 700, 500, 5, 5,
       false, 'single_use_forfeit', NULL, now() + interval '1 year', 'available', 'AUD',
       'AU', 'all_ages', 'food-and-drink', 'https://example.test/p.jpg', 'both', 'single_use')`,
    [id, business, title],
  );
  return id;
}

async function stateOf(table: "campaign.campaigns" | "store.listings", id: string) {
  const { rows } = await owner.query<{ state: string }>(
    `SELECT lifecycle_state AS state FROM ${table} WHERE id = $1`,
    [id],
  );
  return rows[0]?.state;
}

describe("retireLeakedFixtures", () => {
  it("ends a journey's campaign and retires its listing, and nothing a person could have written", async () => {
    const journey = await liveCampaign("Journey 3 AU muz5r03l");
    const blocked = await liveCampaign("Journey 3 ID n2k9 sim-block-me");
    const real = await liveCampaign("Journey 3 for coffee lovers");
    const near = await liveCampaign("Our Journey 3 AU abc");
    const journeyListing = await listing("Journey 4 flat white AU muz5r03l large");
    const realListing = await listing("Journey 4 flat white, to go");

    await retireLeakedFixtures(owner, quiet);

    expect(await stateOf("campaign.campaigns", journey)).toBe("ended");
    expect(await stateOf("campaign.campaigns", blocked)).toBe("ended");
    expect(await stateOf("campaign.campaigns", real)).toBe("live");
    expect(await stateOf("campaign.campaigns", near)).toBe("live");
    expect(await stateOf("store.listings", journeyListing)).toBe("retired");
    expect(await stateOf("store.listings", realListing)).toBe("active");
  });

  it("leaves a journey's campaign that never went live, so the deploy does not fail", async () => {
    // Staging, 2026-10-26: one in review made `in_review -> ended` fail the seed, and every deploy.
    const inReview = await liveCampaign("Journey 3 AU q7x2", "in_review");
    await expect(retireLeakedFixtures(owner, quiet)).resolves.toBeDefined();
    expect(await stateOf("campaign.campaigns", inReview)).toBe("in_review");
  });

  it("is a no-op the second time", async () => {
    await listing("Journey 4 flat white ID k3");
    await retireLeakedFixtures(owner, quiet);
    const again = await retireLeakedFixtures(owner, quiet);
    expect(again.retired).toBe(0);
  });
});
