import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { createSimulatedPayments } from "@yourtal/drivers/payments";
import { runBoostSettle } from "./boost-settle";

/** 13.23.c against real Postgres and the simulated payment driver. */
const DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (DATABASE_URL === undefined) throw new Error("DATABASE_URL/TEST_DATABASE_URL must be set");
const pool = new Pool({ connectionString: DATABASE_URL });

afterAll(async () => {
  await pool.end();
});

/** A boosted AU campaign with spend yesterday and today (Sydney clock). */
async function seedSpend(yesterdayMilli: number, todayMilli: number): Promise<string> {
  const id = randomUUID();
  const businessId = randomUUID();
  await pool.query(
    `INSERT INTO campaign.campaigns
       (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds, reward_points,
        question_count, scoring_rule, lifecycle_state, business_id, region, audience,
        content_category, starts_at, ends_at, open_viewing, teaser_start_seconds)
     VALUES ($1, 'quick', 'Boost settle', $2, 'Boost settle', 'x', 30, 3, 0, 'base_only', 'draft',
             $2, 'AU', 'all_ages', 'food-and-drink', now(), now() + interval '9 days', false, 0)`,
    [id, businessId],
  );
  await pool.query(
    `INSERT INTO feed.boost (campaign_id, business_id, region, currency, daily_budget_minor,
                             max_bid_cpm_minor, starts_at, ends_at, state)
     VALUES ($1, $2, 'AU', 'AUD', 100, 500, now() - interval '2 days', now() + interval '5 days', 'active')`,
    [id, businessId],
  );
  const today = `(now() AT TIME ZONE 'Australia/Sydney')::date`;
  await pool.query(
    `INSERT INTO feed.boost_spend_day (campaign_id, day, impressions, spent_milli) VALUES
       ($1, ${today} - 1, 7, $2), ($1, ${today}, 2, $3)`,
    [id, yesterdayMilli, todayMilli],
  );
  return id;
}

describe("boost-settle job", () => {
  it("charges each closed day once, rounded up to a whole cent, and never today", async () => {
    const campaignId = await seedSpend(2_107, 602);
    const payments = createSimulatedPayments();

    await runBoostSettle(pool, payments);
    await runBoostSettle(pool, payments); // a rerun charges nothing twice

    const { rows } = await pool.query<{
      amount_minor: string;
      impressions: number;
      currency: string;
    }>(`SELECT amount_minor, impressions, currency FROM feed.boost_charge WHERE campaign_id = $1`, [
      campaignId,
    ]);
    expect(rows).toEqual([{ amount_minor: "3", impressions: 7, currency: "AUD" }]);
  });
});
