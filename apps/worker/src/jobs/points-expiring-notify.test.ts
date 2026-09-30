import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { Job } from "pg-boss";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { PointsExpiringEvent } from "@yourtal/contracts/ledger-internal/expiry";
import { toPoints } from "@yourtal/contracts/money";
import { loadWorkerConfig } from "../config";
import { job } from "./points-expiring-notify";

/** Real Postgres — same shape points-unlocked-notify.test.ts uses. */
const DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (DATABASE_URL === undefined) throw new Error("DATABASE_URL/TEST_DATABASE_URL must be set");

const config = loadWorkerConfig({ DATABASE_URL: DATABASE_URL });
const pool = new Pool({ connectionString: DATABASE_URL });

afterAll(async () => {
  await pool.end();
});

function fakeJob(data: PointsExpiringEvent): Job<PointsExpiringEvent> {
  return {
    id: randomUUID(),
    name: "ledger.points_expiring",
    data,
  } as Job<PointsExpiringEvent>;
}

describe("points-expiring-notify job", () => {
  it("writes an in-app notification and sends a push when no preference exists (default: enabled)", async () => {
    const userId = randomUUID();
    const accountId = `usr_${userId}_available`;

    await job.handle(
      fakeJob({
        accountId,
        userId,
        region: "AU",
        milestoneDays: 7,
        expiringAt: "2026-11-01T00:00:00.000Z",
        points: toPoints(50),
        idempotencyKey: `points_expiring_${accountId}_7_2026-11-01T00:00:00.000Z`,
      }),
      { boss: undefined as never, config },
    );

    const rows = await pool.query<{ category: string; body: string }>(
      `SELECT category, body FROM me.notification WHERE user_id = $1`,
      [userId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.category).toBe("points_expiring");
    expect(rows.rows[0]?.body).toContain("50 pts");
    expect(rows.rows[0]?.body).toContain("2026-11-01");
  });

  it("still writes the notification, but skips the push, when the user opted out", async () => {
    const userId = randomUUID();
    const accountId = `usr_${userId}_available`;
    await pool.query(
      `INSERT INTO me.notification_preference (user_id, category, push_enabled) VALUES ($1, 'points_expiring', false)`,
      [userId],
    );

    await job.handle(
      fakeJob({
        accountId,
        userId,
        region: "AU",
        milestoneDays: 30,
        expiringAt: "2026-11-01T00:00:00.000Z",
        points: toPoints(12),
        idempotencyKey: `points_expiring_${accountId}_30_2026-11-01T00:00:00.000Z`,
      }),
      { boss: undefined as never, config },
    );

    const rows = await pool.query(`SELECT 1 FROM me.notification WHERE user_id = $1`, [userId]);
    expect(rows.rows).toHaveLength(1);
  });

  // 12.4.d/#7: a teen never gets this nudge, full stop -- not only during
  // quiet hours (superseding 12.2.b's narrower "silence overnight" rule
  // for THIS job specifically; other jobs, e.g. points-unlocked-notify,
  // keep the quiet-hours-only behaviour).
  it("silences a teen during quiet hours", async () => {
    const userId = randomUUID();
    const accountId = `usr_${userId}_available`;
    await pool.query(
      `INSERT INTO identity.user_profile (user_id, region, display_name, date_of_birth, timezone)
       VALUES ($1, 'AU', 'Quiet Hours Teen', '2012-01-01', 'Australia/Sydney')`,
      [userId],
    );

    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-01T11:00:00.000Z")); // 21:00 AEST
      await job.handle(
        fakeJob({
          accountId,
          userId,
          region: "AU",
          milestoneDays: 7,
          expiringAt: "2026-11-01T00:00:00.000Z",
          points: toPoints(50),
          idempotencyKey: `points_expiring_${accountId}_7_2026-11-01T00:00:00.000Z`,
        }),
        { boss: undefined as never, config },
      );

      const rows = await pool.query(`SELECT 1 FROM me.notification WHERE user_id = $1`, [userId]);
      expect(rows.rows).toHaveLength(0);
    } finally {
      vi.useRealTimers();
      await pool.query(`DELETE FROM identity.user_profile WHERE user_id = $1`, [userId]);
    }
  });

  // 12.4.d/#7: the suppression is not a quiet-hours rule for this job --
  // a teen gets no expiry nudge in the middle of the day either.
  it("silences a teen outside quiet hours too", async () => {
    const userId = randomUUID();
    const accountId = `usr_${userId}_available`;
    await pool.query(
      `INSERT INTO identity.user_profile (user_id, region, display_name, date_of_birth, timezone)
       VALUES ($1, 'AU', 'Daytime Teen', '2012-01-01', 'Australia/Sydney')`,
      [userId],
    );

    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-01T00:00:00.000Z")); // 10:00 AEST -- well outside quiet hours
      await job.handle(
        fakeJob({
          accountId,
          userId,
          region: "AU",
          milestoneDays: 7,
          expiringAt: "2026-11-01T00:00:00.000Z",
          points: toPoints(50),
          idempotencyKey: `points_expiring_${accountId}_7_2026-11-01T00:00:00.000Z`,
        }),
        { boss: undefined as never, config },
      );

      const rows = await pool.query(`SELECT 1 FROM me.notification WHERE user_id = $1`, [userId]);
      expect(rows.rows).toHaveLength(0);
    } finally {
      vi.useRealTimers();
      await pool.query(`DELETE FROM identity.user_profile WHERE user_id = $1`, [userId]);
    }
  });
});
