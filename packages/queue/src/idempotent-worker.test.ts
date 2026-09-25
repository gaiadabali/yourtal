import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { PostgresIdempotencyStore } from "@yourtal/idempotency/postgres-store";
import { idempotentJobHandler } from "./idempotent-worker";
import type { IdempotentJobData } from "./idempotent-worker";

/**
 * YT-0040 AC2, against the real Postgres from `pnpm dev:up` (via
 * `with-test-db.mjs`, so this runs against a fresh migrated database, not
 * the shared "yourtal" one).
 *
 * These prove the concurrency claim directly against `idempotentJobHandler`
 * rather than through a real pg-boss delivery: pg-boss's own row lock
 * (`FOR UPDATE SKIP LOCKED`) already prevents two WORKERS from picking up
 * the same job ROW at once, so routing this test through `boss.send()` +
 * `boss.work()` would only ever exercise one job row at a time and prove
 * nothing about the race this wrapper exists to close — two DIFFERENT rows
 * (two enqueues) racing on the same business key. Calling the handler
 * twice concurrently, with the same key, is that race directly, and it is
 * the database's `putIfAbsent` — not JavaScript's single-threaded execution
 * — that has to settle it.
 */

const { Pool } = pg;

// No hard-coded dev URL (YT-0571): `vitest.config.ts`'s `setupFiles`
// refuses to run this suite unless `DATABASE_URL` names a `yourtal_test_*`
// database, so it is a safe fallback in place of a literal.
const APP_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!;

let pool: pg.Pool;
let store: PostgresIdempotencyStore;

beforeAll(async () => {
  pool = new Pool({ connectionString: APP_URL, max: 8 });
  store = new PostgresIdempotencyStore(pool);
  await pool.query("SELECT 1");
});

afterAll(async () => {
  await pool.query("DELETE FROM platform.idempotency WHERE scope LIKE 'job:test.%'");
  await pool.end();
});

interface DebitJob extends IdempotentJobData {
  readonly accountId: string;
  readonly amountCents: number;
}

let counter = 0;
function uniqueKey(): string {
  counter += 1;
  return `debit-${String(counter)}-${String(Date.now())}`;
}

describe("concurrent double delivery", () => {
  it("runs the handler exactly once when the same job is delivered twice at the same instant", async () => {
    const key = uniqueKey();
    let executions = 0;
    let ledgerBalanceCents = 0;

    const handler = idempotentJobHandler<DebitJob, { newBalance: number }>(
      { store, queueName: "test.ledger.debit" },
      (job) => {
        executions += 1;
        // The side effect a duplicate delivery must not double: simulated
        // here as an in-process counter, standing in for "debit the
        // ledger" — a real consumer's handler is exactly this shape, one
        // write guarded by the claim already won above.
        ledgerBalanceCents -= job.amountCents;
        return Promise.resolve({ newBalance: ledgerBalanceCents });
      },
    );

    const job: DebitJob = { idempotencyKey: key, accountId: "acct_1", amountCents: 500 };

    // Not sequential awaits — both start before either can have finished,
    // which is the only way to exercise `putIfAbsent`'s atomicity rather
    // than its API surface.
    const [first, second] = await Promise.all([handler({ ...job }), handler({ ...job })]);

    expect(executions).toBe(1);
    expect(ledgerBalanceCents).toBe(-500);
    // Exactly one call actually ran the handler and got the real result;
    // the other saw `in_progress` (or, if it lost by enough of a margin,
    // `replay`) and returned undefined without running it.
    const results = [first, second];
    expect(results.filter((r) => r !== undefined)).toHaveLength(1);
  });

  it("lets 8 simultaneous deliveries through as exactly 1 execution", async () => {
    const key = uniqueKey();
    let executions = 0;

    const handler = idempotentJobHandler<DebitJob>(
      { store, queueName: "test.ledger.debit" },
      () => {
        executions += 1;
        return Promise.resolve();
      },
    );

    const job: DebitJob = { idempotencyKey: key, accountId: "acct_2", amountCents: 100 };
    await Promise.all(Array.from({ length: 8 }, () => handler({ ...job })));

    expect(executions).toBe(1);
  });

  it("replays for a duplicate that arrives after the winner already completed", async () => {
    const key = uniqueKey();
    let executions = 0;

    const handler = idempotentJobHandler<DebitJob, { ok: true }>(
      { store, queueName: "test.ledger.debit" },
      () => {
        executions += 1;
        return Promise.resolve({ ok: true });
      },
    );

    const job: DebitJob = { idempotencyKey: key, accountId: "acct_3", amountCents: 250 };
    await handler({ ...job });
    // A late duplicate — the producer's retry landing well after the first
    // attempt finished, not concurrently with it.
    const late = await handler({ ...job });

    expect(executions).toBe(1);
    expect(late).toBeUndefined();
  });
});

describe("handler failure", () => {
  it("releases the claim so a retry of the SAME job is not permanently blocked", async () => {
    const key = uniqueKey();
    let attempt = 0;

    const handler = idempotentJobHandler<DebitJob, { ok: true }>(
      { store, queueName: "test.ledger.debit" },
      () => {
        attempt += 1;
        if (attempt === 1) {
          throw new Error("downstream timeout");
        }
        return Promise.resolve({ ok: true });
      },
    );

    const job: DebitJob = { idempotencyKey: key, accountId: "acct_4", amountCents: 10 };

    await expect(handler({ ...job })).rejects.toThrow("downstream timeout");
    // pg-boss redelivering the identical job row after a failure — this
    // wrapper must not treat that as a duplicate and skip it.
    await expect(handler({ ...job })).resolves.toEqual({ ok: true });
    expect(attempt).toBe(2);
  });
});

describe("producer bug: same key, different job", () => {
  it("throws rather than silently running or silently skipping", async () => {
    const key = uniqueKey();
    const handler = idempotentJobHandler<DebitJob>(
      { store, queueName: "test.ledger.debit" },
      () => Promise.resolve() /* never reached for the second call */,
    );

    await handler({ idempotencyKey: key, accountId: "acct_5", amountCents: 10 });
    await expect(
      handler({ idempotencyKey: key, accountId: "acct_5", amountCents: 999 }),
    ).rejects.toThrow(/reused for a different job payload/);
  });
});

describe("missing key", () => {
  it("refuses to run the handler at all", async () => {
    const handler = idempotentJobHandler<DebitJob>(
      { store, queueName: "test.ledger.debit" },
      (): Promise<void> => {
        throw new Error("must not be called");
      },
    );

    // @ts-expect-error — deliberately missing the required field
    await expect(handler({ accountId: "acct_6", amountCents: 10 })).rejects.toThrow(
      /has no idempotencyKey/,
    );
  });
});
