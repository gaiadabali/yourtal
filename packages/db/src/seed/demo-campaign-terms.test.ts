import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OWNER_URL } from "../database-urls";
import { alignDemoCampaignTerms } from "./demo-campaign-terms";

let owner: pg.Pool;

beforeAll(() => {
  owner = new pg.Pool({ connectionString: OWNER_URL, max: 4 });
});

afterAll(async () => {
  await owner.end();
});

/** A live campaign whose v1 terms promise 80 pts, funded by the seed for base + bonus. */
async function fundedCampaign(questionCount: number, base: number, bonus: number): Promise<string> {
  const id = randomUUID();
  await owner.query(
    `INSERT INTO campaign.campaigns
       (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
        estimated_data_mb, reward_points, question_count, scoring_rule,
        lifecycle_state, published_at, business_id, region, audience, content_category,
        poster_url, teaser_url, hls_url, captions_url, aspect, estimated_bytes,
        starts_at, ends_at, open_viewing, teaser_start_seconds)
     VALUES ($1,'long_form','Terms test',$2,'Test Merchant','A test campaign',90,
             10.5, 80, $3, 'base_only', 'live', now(), $2, 'AU', 'all_ages', 'entertainment',
             'http://127.0.0.1:26900/x/p.jpg', 'http://127.0.0.1:26900/x/t.mp4',
             'http://127.0.0.1:26900/x/i.m3u8', null, '9:16', 1000,
             now(), now() + interval '90 days', true, 0)`,
    [id, randomUUID(), questionCount],
  );
  await owner.query(
    `INSERT INTO campaign.terms_version
       (campaign_id, version, reward_points, question_count, scoring_rule,
        duration_seconds, effective_from, accuracy_bonus_points)
     VALUES ($1, 1, 80, $2, 'base_only', 90, now(), 0)`,
    [id, questionCount],
  );
  await owner.query(
    `INSERT INTO campaign.reward_config
       (campaign_id, allocation_id, funder_type, max_points_for_campaign,
        reward_points_per_completion, accuracy_bonus_points)
     VALUES ($1, $2, 'partner', 10000, $3, $4)`,
    [id, `alloc_demo-campaign-funding:${id}`, base, bonus],
  );
  return id;
}

async function currentTerms(id: string) {
  const result = await owner.query<{
    version: number;
    reward_points: string;
    accuracy_bonus_points: string;
    scoring_rule: string;
  }>(
    `SELECT version, reward_points, accuracy_bonus_points, scoring_rule
       FROM campaign.terms_version WHERE campaign_id = $1 ORDER BY version DESC LIMIT 1`,
    [id],
  );
  return result.rows[0];
}

async function cleanup(id: string): Promise<void> {
  await owner.query(`DELETE FROM campaign.reward_config WHERE campaign_id = $1`, [id]);
  await owner.query(`DELETE FROM campaign.campaigns WHERE id = $1`, [id]);
}

describe("alignDemoCampaignTerms", () => {
  it("appends terms that pay exactly the funded base and bonus, and leaves v1 alone", async () => {
    const id = await fundedCampaign(1, 8, 2);
    try {
      await alignDemoCampaignTerms(owner, () => undefined);
      expect(await currentTerms(id)).toEqual({
        version: 2,
        reward_points: "8",
        accuracy_bonus_points: "2",
        scoring_rule: "base_plus_accuracy_bonus",
      });
      const v1 = await owner.query<{ reward_points: string }>(
        `SELECT reward_points FROM campaign.terms_version WHERE campaign_id = $1 AND version = 1`,
        [id],
      );
      expect(v1.rows[0]?.reward_points).toBe("80");
      const campaign = await owner.query<{ reward_points: string }>(
        `SELECT reward_points FROM campaign.campaigns WHERE id = $1`,
        [id],
      );
      expect(campaign.rows[0]?.reward_points).toBe("8");

      // Aligned already: a second run writes nothing.
      await alignDemoCampaignTerms(owner, () => undefined);
      expect((await currentTerms(id))?.version).toBe(2);
    } finally {
      await cleanup(id);
    }
  });

  it("drops a bonus that no question could ever earn, from the terms and the reward config", async () => {
    const id = await fundedCampaign(0, 3, 1);
    try {
      await alignDemoCampaignTerms(owner, () => undefined);
      expect(await currentTerms(id)).toMatchObject({
        reward_points: "3",
        accuracy_bonus_points: "0",
        scoring_rule: "base_only",
      });
      const config = await owner.query<{ accuracy_bonus_points: string }>(
        `SELECT accuracy_bonus_points FROM campaign.reward_config WHERE campaign_id = $1`,
        [id],
      );
      expect(config.rows[0]?.accuracy_bonus_points).toBe("0");
    } finally {
      await cleanup(id);
    }
  });
});
