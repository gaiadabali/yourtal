import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { Job } from "pg-boss";
import { afterAll, describe, expect, it } from "vitest";
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
});
