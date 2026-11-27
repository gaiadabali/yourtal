import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RETENTION_DAYS, purgeSpambank } from "./purge";
import { deleteMailboxes, insertMailbox, testPool } from "./test-support";

/** BUILD.md T6 done-when (6): rows older than 30 days are purged. */

let pool: Pool;
const made: string[] = [];

beforeAll(() => {
  pool = testPool();
});
afterAll(async () => {
  await deleteMailboxes(pool, made);
  await pool.end();
});

const days = (n: number) => new Date(Date.now() - n * 24 * 3600_000);

describe("purge", () => {
  it("removes bookkeeping older than 30 days and keeps the rest", async () => {
    expect(RETENTION_DAYS).toBe(30);
    const box = await insertMailbox(pool);
    made.push(box.id);
    for (const [id, age] of [
      ["old", 31],
      ["new", 29],
    ] as const) {
      await pool.query(
        `INSERT INTO spambank.ingested_message
           (mailbox_id, email_id, received_at, folder, bulk, dmarc_pass, autoreply_decision, processed_at)
         VALUES ($1, $2, now(), 'inbox', false, false, 'not_bulk', $3)`,
        [box.id, id, days(age)],
      );
      await pool.query(
        `INSERT INTO spambank.statement_offer (mailbox_id, email_id, blob_id, type, size, offered_at)
         VALUES ($1, $2, 'b', 'text/csv', 1, $3)`,
        [box.id, id, days(age)],
      );
    }
    const event = (state: "delivered" | "failed" | "waiting", age: number) =>
      pool.query(
        `INSERT INTO spambank.app_event_outbox
           (jti, client_id, sub, event_type, payload, iat, expires_at, delivered_at, failed_at)
         VALUES ($1, 'c', $2, 't', '{}', $3, $3, $4, $5)`,
        [
          randomUUID(),
          `purge-${box.id}`,
          days(age),
          state === "delivered" ? days(age) : null,
          state === "failed" ? days(age) : null,
        ],
      );
    await event("delivered", 40);
    await event("failed", 40);
    await event("waiting", 40);
    await event("delivered", 5);

    const result = await purgeSpambank(pool);
    expect(result.ingestedMessages).toBeGreaterThanOrEqual(1);
    expect(result.statementOffers).toBeGreaterThanOrEqual(1);
    expect(result.appEvents).toBeGreaterThanOrEqual(2);

    const kept = await pool.query<{ email_id: string }>(
      "SELECT email_id FROM spambank.ingested_message WHERE mailbox_id = $1",
      [box.id],
    );
    expect(kept.rows).toEqual([{ email_id: "new" }]);
    const offers = await pool.query<{ email_id: string }>(
      "SELECT email_id FROM spambank.statement_offer WHERE mailbox_id = $1",
      [box.id],
    );
    expect(offers.rows).toEqual([{ email_id: "new" }]);
    // A finished event older than 30 days is gone; one still waiting, and a recent one, stay.
    const events = await pool.query("SELECT 1 FROM spambank.app_event_outbox WHERE sub = $1", [
      `purge-${box.id}`,
    ]);
    expect(events.rowCount).toBe(2);
  });
});
