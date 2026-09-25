import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { PgBoss } from "pg-boss";
import { createQueueClient } from "./client";
import { defineQueue } from "./define-queue";
import { getDeadLetteredJobs, getQueueDepth, getRetriedJobs } from "./observability";

/**
 * YT-0040 AC1, against the real Postgres from `pnpm dev:up` (via
 * `with-test-db.mjs`) and a real `PgBoss` instance — not a config
 * assertion. A consumer that always throws is registered, one job is sent,
 * and the test waits for pg-boss's own retry/backoff/dead-letter machinery
 * to actually run it into the ground, then reads the result back with
 * plain `SELECT`s — the same queries `./observability` exposes, proving
 * the "observable from the database, no collector" half of this ticket at
 * the same time.
 */

const { Pool } = pg;

// No hard-coded dev URL (YT-0571): `vitest.config.ts`'s `setupFiles`
// refuses to run this suite unless `DATABASE_URL` names a `yourtal_test_*`
// database, so it is a safe fallback in place of a literal.
const APP_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!;

let pool: pg.Pool;
let boss: PgBoss;

beforeAll(async () => {
  pool = new Pool({ connectionString: APP_URL, max: 4 });
  boss = createQueueClient({ databaseUrl: APP_URL });
  await boss.start();
});

afterAll(async () => {
  await boss.stop({ close: true, graceful: false, timeout: 5000 });
  await pool.end();
});

async function waitUntil(
  predicate: () => Promise<boolean>,
  { timeoutMs = 20_000, intervalMs = 200 } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) {
      throw new Error(`waitUntil: condition not met within ${String(timeoutMs)}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

describe("retries, backoff and the dead-letter path", () => {
  it("retries a failing job the configured number of times, on an increasing delay, then dead-letters it", async () => {
    const queueName = `test.flaky.${String(Date.now())}`;
    const { deadLetterName } = await defineQueue(boss, queueName, {
      retryLimit: 2,
      retryDelaySeconds: 1,
      retryBackoff: true,
    });

    const attemptTimestamps: number[] = [];

    await boss.work(queueName, { batchSize: 1 }, (): Promise<void> => {
      attemptTimestamps.push(Date.now());
      throw new Error("simulated downstream failure");
    });

    const jobId = await boss.send(queueName, { probe: "YT-0040" });
    expect(jobId).not.toBeNull();

    // Wait for the terminal state directly by SELECT — no pg-boss API call,
    // so this is watching the database settle rather than trusting the
    // client's own view of it.
    await waitUntil(async () => {
      const { rows } = await pool.query<{ state: string }>(
        `SELECT state::text FROM pgboss.job WHERE name = $1 AND id = $2`,
        [queueName, jobId],
      );
      return rows[0]?.state === "failed";
    });

    // --- retried the configured number of times ---
    expect(attemptTimestamps).toHaveLength(3); // 1 initial attempt + retryLimit(2) retries

    const retried = await getRetriedJobs(pool, queueName);
    const original = retried.find((j) => j.id === jobId);
    expect(original).toBeDefined();
    expect(original?.state).toBe("failed");
    expect(original?.retryCount).toBe(2);
    expect(original?.deadLetter).toBe(deadLetterName);

    // --- on an increasing delay (backoff), not a flat one ---
    // gap(n) = retryDelay * 2^n * (1 + random()), n = retryCount at the
    // time of that retry's scheduling. With retryDelaySeconds=1 the ranges
    // for successive gaps ([1s,2s), [2s,4s), ...) do not overlap, so this
    // is a deterministic ordering, not a statistical one.
    const [t0, t1, t2] = attemptTimestamps;
    if (t0 === undefined || t1 === undefined || t2 === undefined) {
      throw new Error("expected exactly 3 recorded attempt timestamps");
    }
    const firstGapMs = t1 - t0;
    const secondGapMs = t2 - t1;
    expect(secondGapMs).toBeGreaterThan(firstGapMs);

    // --- and then dead-lettered ---
    const depth = await getQueueDepth(pool, queueName);
    expect(depth.failed).toBe(1);

    const deadLettered = await getDeadLetteredJobs(pool, deadLetterName);
    expect(deadLettered).toHaveLength(1);
    expect(deadLettered[0]?.sourceId).toBe(jobId);
    expect(deadLettered[0]?.sourceName).toBe(queueName);
    expect(deadLettered[0]?.sourceRetryCount).toBe(2);
  }, 30_000);
});
