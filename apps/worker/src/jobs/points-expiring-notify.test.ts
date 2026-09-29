import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { Job } from "pg-boss";
import { afterAll, describe, expect, it } from "vitest";
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
});
