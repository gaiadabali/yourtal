import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { Job } from "pg-boss";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { CampaignPublishedEvent } from "@yourtal/contracts/studio/campaign-published-event";
import { loadWorkerConfig } from "../config";
import { job } from "./campaign-published-notify";

/**
 * Real Postgres (YT-0547's `with-test-db.mjs`), the job's `handle()` called
 * directly — same shape as `points-unlocked-notify.test.ts`.
 */
const DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (DATABASE_URL === undefined) throw new Error("DATABASE_URL/TEST_DATABASE_URL must be set");

const config = loadWorkerConfig({ DATABASE_URL: DATABASE_URL });
const pool = new Pool({ connectionString: DATABASE_URL });

afterAll(async () => {
  await pool.end();
});

function fakeJob(data: CampaignPublishedEvent): Job<CampaignPublishedEvent> {
  return {
    id: randomUUID(),
    name: "campaign.published",
    data,
  } as Job<CampaignPublishedEvent>;
}

describe("campaign-published-notify job", () => {
  it("notifies every follower of the business, in its own region", async () => {
    const businessId = randomUUID();
    const campaignId = randomUUID();
    const follower1 = randomUUID();
    const follower2 = randomUUID();
    // A follower of a DIFFERENT business must not be notified.
    const stranger = randomUUID();

    await pool.query(
      `INSERT INTO me.follow (user_id, business_id, region) VALUES ($1, $2, 'AU'), ($3, $2, 'AU')`,
      [follower1, businessId, follower2],
    );
    await pool.query(`INSERT INTO me.follow (user_id, business_id, region) VALUES ($1, $2, 'AU')`, [
      stranger,
      randomUUID(),
    ]);

    await job.handle(
      fakeJob({
        campaignId,
        businessId,
        region: "AU",
        idempotencyKey: `campaign_published_${campaignId}`,
      }),
      { boss: undefined as never, config },
    );

    const rows = await pool.query<{ user_id: string; category: string }>(
      `SELECT user_id, category FROM me.notification WHERE user_id = ANY($1)`,
      [[follower1, follower2, stranger]],
    );
    const notifiedUsers = rows.rows.map((row) => row.user_id).sort();
    expect(notifiedUsers).toStrictEqual([follower1, follower2].sort());
    expect(rows.rows[0]?.category).toBe("campaign_published");
  });

  it("does nothing when the business has no followers", async () => {
    const businessId = randomUUID();
    const campaignId = randomUUID();

    // Should not throw, and should leave no notification rows behind.
    await job.handle(
      fakeJob({
        campaignId,
        businessId,
        region: "ID",
        idempotencyKey: `campaign_published_${campaignId}`,
      }),
      { boss: undefined as never, config },
    );

    const rows = await pool.query(
      `SELECT 1 FROM me.notification WHERE metadata->>'campaignId' = $1`,
      [campaignId],
    );
    expect(rows.rows).toHaveLength(0);
  });

  it("still writes the notification, but skips the push, when a follower opted out", async () => {
    const businessId = randomUUID();
    const campaignId = randomUUID();
    const follower = randomUUID();

    await pool.query(`INSERT INTO me.follow (user_id, business_id, region) VALUES ($1, $2, 'AU')`, [
      follower,
      businessId,
    ]);
    await pool.query(
      `INSERT INTO me.notification_preference (user_id, category, push_enabled) VALUES ($1, 'campaign_published', false)`,
      [follower],
    );

    await job.handle(
      fakeJob({
        campaignId,
        businessId,
        region: "AU",
        idempotencyKey: `campaign_published_${campaignId}`,
      }),
      { boss: undefined as never, config },
    );

    const rows = await pool.query(`SELECT 1 FROM me.notification WHERE user_id = $1`, [follower]);
    expect(rows.rows).toHaveLength(1);
  });

  // 12.1.b: the audience wall reaches this fan-out too. Minimal
  // `campaign.campaigns` row, same columns `feed.controller.e2e.test.ts`'s
  // own `seedCampaign` helper inserts.
  it("skips a follower whose age band the campaign's audience does not reach", async () => {
    const businessId = randomUUID();
    const campaignId = randomUUID();
    const adultFollower = randomUUID();
    const teenFollower = randomUUID();
    // No `identity.user_profile` row at all -- an ageBand nobody can prove.
    const noProfileFollower = randomUUID();

    await pool.query(
      `INSERT INTO identity.user_profile (user_id, region, display_name, date_of_birth, timezone)
       VALUES ($1, 'AU', 'Adult Follower', '1990-01-01', 'Australia/Sydney'),
              ($2, 'AU', 'Teen Follower', $3, 'Australia/Sydney')`,
      [adultFollower, teenFollower, fifteenYearsAgo()],
    );
    await pool.query(
      `INSERT INTO me.follow (user_id, business_id, region) VALUES ($1, $2, 'AU'), ($3, $2, 'AU'), ($4, $2, 'AU')`,
      [adultFollower, businessId, teenFollower, noProfileFollower],
    );
    await pool.query(
      `INSERT INTO campaign.campaigns
        (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
         estimated_data_mb, reward_points, question_count, scoring_rule, lifecycle_state,
         published_at, business_id, region, audience, content_category, poster_url,
         teaser_url, hls_url, aspect, estimated_bytes, starts_at, ends_at, open_viewing,
         teaser_start_seconds)
       VALUES
        ($1, 'quick', 'Adult-only notify test', $2, 'Notify Test Merchant',
         'Exercises 12.1.b.', 30, 10, 100, 0, 'base_only', 'live',
         now(), $2, 'AU', 'adult', 'food-and-drink',
         'https://cdn.example.com/poster.jpg', 'https://cdn.example.com/teaser.mp4',
         'https://cdn.example.com/manifest.m3u8', '9:16', 1000000, now() - interval '1 day',
         now() + interval '30 days', false, 0)`,
      [campaignId, businessId],
    );

    try {
      await job.handle(
        fakeJob({
          campaignId,
          businessId,
          region: "AU",
          idempotencyKey: `campaign_published_${campaignId}`,
        }),
        { boss: undefined as never, config },
      );

      const rows = await pool.query<{ user_id: string }>(
        `SELECT user_id FROM me.notification WHERE user_id = ANY($1)`,
        [[adultFollower, teenFollower, noProfileFollower]],
      );
      expect(rows.rows.map((row) => row.user_id)).toStrictEqual([adultFollower]);
    } finally {
      await pool.query(`DELETE FROM campaign.campaigns WHERE id = $1`, [campaignId]);
    }
  });

  // 12.2.b / 12.2.d's Check: a teen follower gets no notification between
  // 21:00 and 07:00 in THEIR OWN profile timezone, even though the same
  // audience wall above would otherwise let this campaign reach them.
  it("silences a teen follower during quiet hours, but not the same teen outside them, and not an adult follower either way", async () => {
    const businessId = randomUUID();
    const campaignId = randomUUID();
    const teenFollower = randomUUID();
    const adultFollower = randomUUID();

    await pool.query(
      `INSERT INTO identity.user_profile (user_id, region, display_name, date_of_birth, timezone)
       VALUES ($1, 'AU', 'Quiet Hours Teen', '2012-01-01', 'Australia/Sydney'),
              ($2, 'AU', 'Quiet Hours Adult', '1990-01-01', 'Australia/Sydney')`,
      [teenFollower, adultFollower],
    );
    await pool.query(
      `INSERT INTO me.follow (user_id, business_id, region) VALUES ($1, $2, 'AU'), ($3, $2, 'AU')`,
      [teenFollower, businessId, adultFollower],
    );

    const event = {
      campaignId,
      businessId,
      region: "AU" as const,
      idempotencyKey: `campaign_published_${campaignId}`,
    };

    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-01T11:00:00.000Z")); // 21:00 AEST
      await job.handle(fakeJob(event), { boss: undefined as never, config });

      const duringQuietHours = await pool.query<{ user_id: string }>(
        `SELECT user_id FROM me.notification WHERE user_id = ANY($1)`,
        [[teenFollower, adultFollower]],
      );
      // The adult is notified; the teen, mid quiet-hours, is not.
      expect(duringQuietHours.rows.map((row) => row.user_id)).toStrictEqual([adultFollower]);

      vi.setSystemTime(new Date("2026-07-01T00:00:00.000Z")); // 10:00 AEST, next day
      await job.handle(
        fakeJob({ ...event, idempotencyKey: `${event.idempotencyKey}_2` }),
        { boss: undefined as never, config },
      );
      const outsideQuietHours = await pool.query<{ user_id: string }>(
        `SELECT DISTINCT user_id FROM me.notification WHERE user_id = ANY($1)`,
        [[teenFollower, adultFollower]],
      );
      // Now both have been notified at least once -- the teen's silence
      // during the first run was quiet-hours, not a permanent refusal.
      expect(outsideQuietHours.rows.map((row) => row.user_id).sort()).toStrictEqual(
        [teenFollower, adultFollower].sort(),
      );
    } finally {
      vi.useRealTimers();
      await pool.query(`DELETE FROM identity.user_profile WHERE user_id = ANY($1)`, [
        [teenFollower, adultFollower],
      ]);
    }
  });
});

/** ISO date (`YYYY-MM-DD`) for someone who turned 15 sometime in the last year. */
function fifteenYearsAgo(): string {
  const now = new Date();
  const dob = new Date(Date.UTC(now.getUTCFullYear() - 15, now.getUTCMonth(), now.getUTCDate()));
  const iso = dob.toISOString().split("T")[0];
  if (iso === undefined) throw new Error("unreachable: toISOString always has a date part");
  return iso;
}
