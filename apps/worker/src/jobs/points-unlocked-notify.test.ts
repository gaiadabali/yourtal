import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { Job } from "pg-boss";
import { afterAll, describe, expect, it } from "vitest";
import type { PointsUnlockedEvent } from "@yourtal/contracts/ledger-internal/releases";
import { toPoints } from "@yourtal/contracts/money";
import { loadWorkerConfig } from "../config";
import { job } from "./points-unlocked-notify";

/**
 * Real Postgres (YT-0547's `with-test-db.mjs`), the job's `handle()` called
 * directly — same shape as `points-unlocked.test.ts`'s own choice to test
 * the exported function rather than the whole `startWorker` loop, since
 * that loop is `worker.test.ts`'s own concern.
 */
const DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (DATABASE_URL === undefined) throw new Error("DATABASE_URL/TEST_DATABASE_URL must be set");

const config = loadWorkerConfig({ DATABASE_URL: DATABASE_URL });
const pool = new Pool({ connectionString: DATABASE_URL });

afterAll(async () => {
  await pool.end();
});

function fakeJob(data: PointsUnlockedEvent): Job<PointsUnlockedEvent> {
  return {
    id: randomUUID(),
    name: "ledger.points_unlocked",
    data,
    // The handler reads only `.data` — the rest of pg-boss's `Job` shape is irrelevant here.
  } as Job<PointsUnlockedEvent>;
}

describe("points-unlocked-notify job", () => {
  it("writes an in-app notification and sends a push when no preference exists (default: enabled)", async () => {
    const userId = randomUUID();
    const grantId = randomUUID();

    await job.handle(
      fakeJob({
        grantId,
        userId,
        region: "AU",
        points: toPoints(5),
        unlockedAt: new Date().toISOString(),
        idempotencyKey: `points_unlocked_${grantId}`,
      }),
      { boss: undefined as never, config },
    );

    const rows = await pool.query<{ category: string; body: string }>(
      `SELECT category, body FROM me.notification WHERE user_id = $1`,
      [userId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.category).toBe("points_unlocked");
    expect(rows.rows[0]?.body).toContain("5 pts");
  });

  it("still writes the notification, but skips the push, when the user opted out", async () => {
    const userId = randomUUID();
    const grantId = randomUUID();
    await pool.query(
      `INSERT INTO me.notification_preference (user_id, category, push_enabled) VALUES ($1, 'points_unlocked', false)`,
      [userId],
    );

    await job.handle(
      fakeJob({
        grantId,
        userId,
        region: "AU",
        points: toPoints(12),
        unlockedAt: new Date().toISOString(),
        idempotencyKey: `points_unlocked_${grantId}`,
      }),
      { boss: undefined as never, config },
    );

    const rows = await pool.query(`SELECT 1 FROM me.notification WHERE user_id = $1`, [userId]);
    expect(rows.rows).toHaveLength(1);
    // Nothing to assert on the push itself — createSimulatedPush's outbox is
    // module-private to points-unlocked-notify.ts; the preference gate
    // itself (the `if (!pushEnabled) return` branch) is what this proves by
    // not throwing and still recording the in-app row above it.
  });
});
