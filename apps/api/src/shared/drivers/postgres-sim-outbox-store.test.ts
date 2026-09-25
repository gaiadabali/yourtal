import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresSimOutboxStore } from "./postgres-sim-outbox-store";

/**
 * Against the real Postgres from `pnpm dev:up` (via `with-test-db.mjs`,
 * apps/api's own `test` script) — proves the migration and the store agree,
 * not just that the SQL parses.
 */

// No hard-coded dev URL (YT-0571): apps/api's vitest.config.ts refuses to run
// this suite against anything but a yourtal_test_* database.
const APP_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (APP_URL === undefined) throw new Error("DATABASE_URL/TEST_DATABASE_URL must be set");

let pool: Pool;
let store: PostgresSimOutboxStore;

beforeAll(() => {
  pool = new Pool({ connectionString: APP_URL, max: 4 });
  store = new PostgresSimOutboxStore(pool);
});

afterAll(async () => {
  await pool.query("DELETE FROM platform.sim_outbox WHERE recipient LIKE '%example.test'");
  await pool.end();
});

describe("PostgresSimOutboxStore", () => {
  it("records a row a plain SELECT can read back", async () => {
    const key = randomUUID();
    const record = await store.record({
      boundary: "email",
      region: "AU",
      recipient: "person@example.test",
      category: "email_verification",
      subject: "Verify your email",
      body: "Click the link.",
      idempotencyKey: key,
    });

    const { rows } = await pool.query<{ recipient: string; region: string }>(
      "SELECT recipient, region FROM platform.sim_outbox WHERE id = $1",
      [record.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.recipient).toBe("person@example.test");
    expect(rows[0]?.region).toBe("AU");
  });

  it("a replayed (boundary, idempotencyKey) returns the ORIGINAL row, not a second one", async () => {
    const key = randomUUID();
    const first = await store.record({
      boundary: "push",
      region: "AU",
      recipient: "device-token-1@example.test",
      category: "points_unlocked",
      body: "first",
      idempotencyKey: key,
    });

    const replay = await store.record({
      boundary: "push",
      region: "ID",
      recipient: "a-different-token@example.test",
      category: "streak_reminder",
      body: "second",
      idempotencyKey: key,
    });

    expect(replay).toStrictEqual(first);

    const { rows } = await pool.query<{ count: string }>(
      "SELECT count(*)::text FROM platform.sim_outbox WHERE boundary = 'push' AND idempotency_key = $1",
      [key],
    );
    expect(rows[0]?.count).toBe("1");
  });

  it("the same idempotencyKey under a DIFFERENT boundary is a distinct row", async () => {
    const key = randomUUID();
    const email = await store.record({
      boundary: "email",
      region: "AU",
      recipient: "shared-key-email@example.test",
      category: "email_verification",
      body: "an email",
      idempotencyKey: key,
    });
    const webhook = await store.record({
      boundary: "webhook",
      region: "AU",
      recipient: "https://partner.example.test/webhooks/yourtal",
      category: "voucher.captured",
      body: "{}",
      idempotencyKey: key,
    });

    expect(webhook.id).not.toBe(email.id);
  });

  it("omits subject when the message did not have one", async () => {
    const record = await store.record({
      boundary: "webhook",
      region: "AU",
      recipient: "https://partner.example.test/webhooks/yourtal",
      category: "voucher.captured",
      body: "{}",
      idempotencyKey: randomUUID(),
    });
    expect(record.subject).toBeUndefined();
  });
});
