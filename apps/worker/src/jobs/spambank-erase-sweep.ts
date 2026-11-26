import type { Pool } from "pg";
import { eraseSpambankMailbox } from "@yourtal/db/dsar-spambank-handlers";
import { describeProblem, resolveDriverMode } from "@yourtal/drivers/driver-mode";
import { createSpambankDriver } from "@yourtal/drivers/spambank";
import type { SpambankDriver } from "@yourtal/drivers/spambank";
import { createPool } from "../pool";
import { defineJob } from "../job";

/**
 * Spambank deletion (spambank/BUILD.md section 4.11), every 5 minutes. Deleting a YourTal account, or
 * only its mailbox, marks the `spambank.mailbox` row `erasing` and retires its name in the database;
 * destroying the mail account at Stalwart is a call to another server, so it is done here. The row
 * goes only once the account is gone, so a Stalwart that is down delays it and loses nothing.
 *
 * It also catches a mailbox whose YourTal account is gone but whose own erase handler never ran (the
 * payment-customer-purge pattern): such a row is erased first, then destroyed. The deletion deadline
 * is 72 hours (docs/29); the sweep keeps it to minutes.
 */
const BATCH = 50;

export interface SweepResult {
  /** Rows that were `erasing` and are now gone, with their accounts destroyed. */
  readonly erased: number;
  /** Mailboxes of accounts that no longer exist, which the sweep erased itself. */
  readonly orphans: number;
  /** Accounts Stalwart would not destroy this time; the next run tries again. */
  readonly failed: number;
}

/** Exported for tests. */
export async function sweepErasingMailboxes(
  db: Pool,
  driver: SpambankDriver,
  log: (message: string) => void = (message) => console.error(message),
): Promise<SweepResult> {
  let orphans = 0;
  const gone = await db.query<{ user_id: string }>(
    `SELECT m.user_id FROM spambank.mailbox m
      WHERE m.status <> 'erasing'
        AND m.created_at < now() - interval '10 minutes'
        AND NOT EXISTS (SELECT 1 FROM identity.user_profile p WHERE p.user_id = m.user_id)
        -- Under a region setting the other region's profiles look gone: find nobody then.
        AND nullif(current_setting('yourtal.region', true), '') IS NULL
      LIMIT $1`,
    [BATCH],
  );
  for (const { user_id: userId } of gone.rows) {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await eraseSpambankMailbox(client, userId);
      await client.query("COMMIT");
      orphans += 1;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      log(
        `[spambank] erasing an orphaned mailbox failed: ${error instanceof Error ? error.message : "?"}`,
      );
    } finally {
      client.release();
    }
  }

  const due = await db.query<{ id: string; stalwart_account_id: string | null }>(
    `SELECT id, stalwart_account_id FROM spambank.mailbox
      WHERE status = 'erasing' ORDER BY updated_at LIMIT $1`,
    [BATCH],
  );
  let erased = 0;
  let failed = 0;
  for (const row of due.rows) {
    if (row.stalwart_account_id !== null) {
      const destroyed = await driver.destroyAccount(row.stalwart_account_id);
      if (destroyed.isErr()) {
        failed += 1;
        // The mailbox id, never the address or a credential.
        log(
          `[spambank] destroying the account of mailbox ${row.id} failed (${destroyed.error.code})`,
        );
        continue;
      }
    }
    await db.query(`DELETE FROM spambank.mailbox WHERE id = $1 AND status = 'erasing'`, [row.id]);
    erased += 1;
  }
  return { erased, orphans, failed };
}

let pool: Pool | undefined;
let driver: SpambankDriver | undefined;

function driverFor(): SpambankDriver {
  if (driver === undefined) {
    const mode = resolveDriverMode("spambank", process.env);
    if (mode.isErr()) throw new Error(describeProblem(mode.error));
    driver = createSpambankDriver(mode.value, process.env);
  }
  return driver;
}

export const job = defineJob({
  queue: "spambank.erase_sweep",
  schedule: "*/5 * * * *",
  async handle(_job, { config }) {
    pool ??= createPool(config.databaseUrl);
    await sweepErasingMailboxes(pool, driverFor());
  },
});
