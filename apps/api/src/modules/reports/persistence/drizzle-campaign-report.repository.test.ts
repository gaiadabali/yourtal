import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { testDb } from "../../../shared/testing/test-db";
import { DrizzleCampaignReportRepository } from "./drizzle-campaign-report.repository";

/**
 * 7.6.b's own Check, half of it: the repository's aggregates match the
 * database, against a real Postgres. A dedicated campaign row (not a
 * seeded mock one) so this suite's counts cannot be polluted by another
 * suite driving a real watch session against a shared fixture campaign.
 */
const db = testDb();
const repo = new DrizzleCampaignReportRepository(db);

const BUSINESS_ID = randomUUID();
const CAMPAIGN_ID = randomUUID();
const TERMS_VERSION = 1;

beforeAll(async () => {
  await db.execute(sql`
    INSERT INTO campaign.campaigns
      (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
       estimated_data_mb, reward_points, question_count, scoring_rule, lifecycle_state,
       published_at, business_id, region, audience, content_category, poster_url,
       teaser_url, hls_url, aspect, estimated_bytes, starts_at, ends_at, open_viewing,
       teaser_start_seconds)
    VALUES
      (${CAMPAIGN_ID}, 'long_form', 'Reports Test Campaign', ${BUSINESS_ID}, 'Reports Test Merchant',
       'Exercises 7.6''s campaign report aggregates.', 30, 10, 100, 2, 'base_only', 'live',
       now(), ${BUSINESS_ID}, 'AU', 'all_ages', 'food-and-drink',
       'https://cdn.example.com/poster.jpg', 'https://cdn.example.com/teaser.mp4',
       'https://cdn.example.com/manifest.m3u8', '9:16', 1000000, now(), now() + interval '30 days',
       false, 0)
  `);
  await db.execute(sql`
    INSERT INTO campaign.terms_version
      (campaign_id, version, reward_points, question_count, scoring_rule, duration_seconds,
       accuracy_bonus_points, effective_from)
    VALUES (${CAMPAIGN_ID}, ${TERMS_VERSION}, 100, 2, 'base_only', 30, 0, now())
  `);

  const questionIds = [randomUUID(), randomUUID()];
  for (const questionId of questionIds) {
    await db.execute(sql`
      INSERT INTO campaign.question
        (id, campaign_id, type, prompt, timer_seconds, status, pii_screen, times_asked, times_correct)
      VALUES (${questionId}, ${CAMPAIGN_ID}, 'true_false', 'Was this segment about the merchant?',
              20, 'approved', 'clear', 10, 7)
    `);
  }
});

async function insertSession(args: {
  completed: boolean;
  watchSeconds?: number;
  questionsAsked?: number;
  questionsCorrect?: number;
}): Promise<void> {
  const startedAt = new Date(Date.now() - (args.watchSeconds ?? 30) * 1000);
  const completedAt = args.completed ? new Date() : null;
  await db.execute(sql`
    INSERT INTO watch.session
      (id, user_id, campaign_id, terms_version, state, started_at, last_progress_at,
       completed_at, non_earning, non_earning_reason, hold_id, questions_asked,
       questions_correct, granted)
    VALUES
      (${randomUUID()}, ${randomUUID()}, ${CAMPAIGN_ID}, ${TERMS_VERSION},
       ${args.completed ? "completed" : "active"}, ${startedAt.toISOString()}, now(),
       ${completedAt?.toISOString() ?? null}, false, null, null,
       ${args.questionsAsked ?? 2}, ${args.questionsCorrect ?? 2}, ${args.completed})
  `);
}

async function insertOpenViewSession(watchedSeconds = 30): Promise<void> {
  await db.execute(sql`
    INSERT INTO watch.open_view_session
      (id, campaign_id, region, ip_hash, started_at, last_progress_at, watched_seconds)
    VALUES (${randomUUID()}, ${CAMPAIGN_ID}, 'AU', ${randomUUID()}, now(), now(), ${watchedSeconds})
  `);
}

describe("DrizzleCampaignReportRepository", () => {
  it("findOwnedCampaign returns the campaign's own audience, or null outside the tenant", async () => {
    const found = await repo.findOwnedCampaign(BUSINESS_ID, CAMPAIGN_ID);
    expect(found).toStrictEqual({ campaignId: CAMPAIGN_ID, audience: "all_ages" });
    expect(await repo.findOwnedCampaign(randomUUID(), CAMPAIGN_ID)).toBeNull();
  });

  it("sessionAggregates counts rewarded views, completions and average watch time exactly", async () => {
    // 4 completed at a known watch time, 3 not completed.
    await insertSession({ completed: true, watchSeconds: 20 });
    await insertSession({ completed: true, watchSeconds: 30 });
    await insertSession({ completed: true, watchSeconds: 25 });
    await insertSession({ completed: true, watchSeconds: 25 });
    await insertSession({ completed: false });
    await insertSession({ completed: false });
    await insertSession({ completed: false });

    const aggregates = await repo.sessionAggregates(CAMPAIGN_ID);
    expect(aggregates.rewardedViews).toBe(7);
    expect(aggregates.completions).toBe(4);
    // (20+30+25+25)/4 = 25, within a second for clock jitter between INSERT and now().
    expect(aggregates.averageWatchTimeSeconds).not.toBeNull();
    expect(aggregates.averageWatchTimeSeconds ?? 0).toBeGreaterThanOrEqual(24);
    expect(aggregates.averageWatchTimeSeconds ?? 0).toBeLessThanOrEqual(26);
  });

  it("questionAggregates sums times_asked/times_correct across every question on the campaign", async () => {
    const aggregates = await repo.questionAggregates(CAMPAIGN_ID);
    // Two seeded questions, 10 asked / 7 correct each.
    expect(aggregates).toStrictEqual({ timesAsked: 20, timesCorrect: 14 });
  });

  it("questionAggregates is null for a campaign with no questions at all", async () => {
    expect(await repo.questionAggregates(randomUUID())).toBeNull();
  });

  it("openViewCount counts watch.open_view_session rows for this campaign, from its OWN table -- 11.2.d", async () => {
    expect(await repo.openViewCount(CAMPAIGN_ID)).toBe(0);
    await insertOpenViewSession();
    await insertOpenViewSession();
    await insertOpenViewSession();
    expect(await repo.openViewCount(CAMPAIGN_ID)).toBe(3);
    // A different campaign's open views never leak in.
    expect(await repo.openViewCount(randomUUID())).toBe(0);
  });
});
