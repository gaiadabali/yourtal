import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { runStreakBackstop } from "./streak-backstop";

/**
 * Real Postgres (YT-0547's `with-test-db.mjs`) — seeds `identity.user_profile`
 * and `watch.session` rows directly by SQL, same "trigger from the
 * interface as it exists" approach `streak.service.test.ts` (apps/api,
 * 5.5.a) uses, since the real HTTP completion path writes `watch.session`
 * itself and this job only ever reads it.
 */
const DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (DATABASE_URL === undefined) throw new Error("DATABASE_URL/TEST_DATABASE_URL must be set");

const pool = new Pool({ connectionString: DATABASE_URL });

afterAll(async () => {
  await pool.end();
});

async function seededCampaign(): Promise<{ campaignId: string; termsVersion: number }> {
  // Only a campaign with terms: other suites sharing this database insert
  // campaigns without any, and the newest overall may be one of them.
  const campaigns = await pool.query<{ id: string }>(
    `SELECT c.id FROM campaign.campaigns c
      WHERE c.lifecycle_state IN ('live','paused','ended')
        AND EXISTS (SELECT 1 FROM campaign.terms_version t WHERE t.campaign_id = c.id)
      ORDER BY c.published_at DESC LIMIT 1`,
  );
  const campaignId = campaigns.rows[0]?.id;
  if (campaignId === undefined) throw new Error("expected at least one seeded campaign");
  const terms = await pool.query<{ version: number }>(
    `SELECT version FROM campaign.terms_version WHERE campaign_id = $1 ORDER BY version DESC LIMIT 1`,
    [campaignId],
  );
  const termsVersion = terms.rows[0]?.version;
  if (termsVersion === undefined) throw new Error("expected the seeded campaign to carry terms");
  return { campaignId, termsVersion };
}

async function seedProfile(
  userId: string,
  dateOfBirth: string,
  region: "AU" | "ID" = "AU",
): Promise<void> {
  const timezone = region === "AU" ? "Australia/Sydney" : "Asia/Jakarta";
  await pool.query(
    `INSERT INTO identity.user_profile (user_id, region, display_name, date_of_birth, timezone)
     VALUES ($1, $2, 'Backstop Test', $3, $4)`,
    [userId, region, dateOfBirth, timezone],
  );
}

async function seedCompletedSession(
  userId: string,
  completedAt: Date,
  campaign: { campaignId: string; termsVersion: number },
): Promise<void> {
  await pool.query(
    `INSERT INTO watch.session (id, user_id, campaign_id, terms_version, state, started_at, last_progress_at, completed_at)
     VALUES ($1, $2, $3, $4, 'completed', $5, $5, $5)`,
    [randomUUID(), userId, campaign.campaignId, campaign.termsVersion, completedAt],
  );
}

/** Enough reserve that `coverage()`'s ratio comfortably clears the 1.1 pause threshold (F12). */
async function fundReserve(region: "AU" | "ID", minor: number): Promise<void> {
  const allocation = await pool.query<{ id: string }>(
    `INSERT INTO platform.ledger_fake_allocation
       (business_id, region, funder_type, currency, total_points, remaining_points)
     VALUES ($1, $2, 'marketing', $3, 1, 1) RETURNING id`,
    [randomUUID(), region, region === "AU" ? "AUD" : "IDR"],
  );
  const allocationId = allocation.rows[0]?.id;
  if (allocationId === undefined) throw new Error("fake allocation insert returned no row");
  await pool.query(
    `INSERT INTO platform.ledger_fake_point_purchase
       (business_id, region, currency, points, paid_minor, allocation_id, idempotency_key)
     VALUES ($1, $2, $3, 1, $4, $5, $6)`,
    [
      randomUUID(),
      region,
      region === "AU" ? "AUD" : "IDR",
      minor,
      allocationId,
      `test-reserve-${randomUUID()}`,
    ],
  );
}

describe("streak-backstop job", () => {
  it("grants the day-3 bonus for a user who never calls GET /api/me/streak, exactly once", async () => {
    const campaign = await seededCampaign();
    const userId = randomUUID();
    await seedProfile(userId, "1990-01-01");
    await fundReserve("AU", 1_000_000_00);

    await seedCompletedSession(userId, new Date("2026-05-01T04:00:00Z"), campaign);
    await seedCompletedSession(userId, new Date("2026-05-02T04:00:00Z"), campaign);
    await seedCompletedSession(userId, new Date("2026-05-03T04:00:00Z"), campaign);

    await runStreakBackstop(pool, new Date("2026-05-03T12:00:00Z"));

    const grants = await pool.query<{ points: string }>(
      `SELECT points FROM platform.ledger_fake_grant WHERE user_id = $1 AND kind = 'streak'`,
      [userId],
    );
    expect(grants.rows).toHaveLength(1);
    expect(Number(grants.rows[0]?.points)).toBe(5); // AU day3 (F12 default)

    // A second tick (the next hour) must not grant it again.
    await runStreakBackstop(pool, new Date("2026-05-03T13:00:00Z"));
    const again = await pool.query(
      `SELECT 1 FROM platform.ledger_fake_grant WHERE user_id = $1 AND kind = 'streak'`,
      [userId],
    );
    expect(again.rows).toHaveLength(1);
  });

  it("two concurrent ticks for the same user grant at most once (5.5.d's race, real Postgres)", async () => {
    const campaign = await seededCampaign();
    const userId = randomUUID();
    await seedProfile(userId, "1990-01-01");
    await fundReserve("AU", 1_000_000_00);

    await seedCompletedSession(userId, new Date("2026-06-01T04:00:00Z"), campaign);
    await seedCompletedSession(userId, new Date("2026-06-02T04:00:00Z"), campaign);
    await seedCompletedSession(userId, new Date("2026-06-03T04:00:00Z"), campaign);

    const now = new Date("2026-06-03T12:00:00Z");
    // Two ticks racing on the SAME row: `me.streak_state`'s row lock
    // (`processCandidate`'s `FOR UPDATE`) must serialise them rather than
    // let both read `day3Granted: false` and both grant.
    await Promise.all([runStreakBackstop(pool, now), runStreakBackstop(pool, now)]);

    const grants = await pool.query(
      `SELECT 1 FROM platform.ledger_fake_grant WHERE user_id = $1 AND kind = 'streak'`,
      [userId],
    );
    expect(grants.rows).toHaveLength(1);
  });

  it("does not grant while a region's coverage is below 1.1 threshold, and defers rather than crashing", async () => {
    const campaign = await seededCampaign();
    const userId = randomUUID();
    // ID, not AU: isolates this from the other two tests' own AU reserve —
    // a directly-inserted outstanding grant with NO matching reserve makes
    // `nothingOwed` false and the ratio 0, deterministically, regardless of
    // what else this shared test database holds.
    await seedProfile(userId, "1990-01-01", "ID");
    await pool.query(
      `INSERT INTO platform.ledger_fake_grant (id, kind, user_id, region, points, unlock_at, granted_at, idempotency_key)
       VALUES ($1, 'goodwill', $2, 'ID', 1000000, now(), now(), $3)`,
      [randomUUID(), randomUUID(), `test-outstanding-${userId}`],
    );

    await seedCompletedSession(userId, new Date("2026-07-01T04:00:00Z"), campaign);
    await seedCompletedSession(userId, new Date("2026-07-02T04:00:00Z"), campaign);
    await seedCompletedSession(userId, new Date("2026-07-03T04:00:00Z"), campaign);

    await runStreakBackstop(pool, new Date("2026-07-03T12:00:00Z"));

    const state = await pool.query<{ current_length: number; day3_granted: boolean }>(
      `SELECT current_length, day3_granted FROM me.streak_state WHERE user_id = $1`,
      [userId],
    );
    expect(state.rows[0]?.current_length).toBe(3);
    // Day count stands even though the bonus itself is deferred (F12: "a
    // broken streak never costs points"); day3Granted stays false so a
    // later tick, once coverage recovers, still pays it.
    expect(state.rows[0]?.day3_granted).toBe(false);
  });
});
