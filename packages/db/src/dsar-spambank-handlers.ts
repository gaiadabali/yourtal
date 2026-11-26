import type pg from "pg";
import type { DomainHandler } from "@yourtal/consent/dsar-orchestrator";

/**
 * The `spambank` DSAR domain (spambank/BUILD.md §4.11): the person's mailbox leaves the service.
 *
 * Everything the database holds about their mail goes at once (brand sightings, statement offers,
 * unsubscribes, ingest decisions), the mailbox row is marked `erasing` and its name is retired for
 * ever, in one transaction. Destroying the Stalwart account (and with it the mail) is a call to
 * another server, so it is not done here: the worker's `spambank-erase-sweep` finds `erasing` rows
 * every five minutes, destroys the account and deletes the row. It also picks up a mailbox whose
 * account is gone but whose own handler never ran.
 *
 * `erase`: nothing here is owed to anyone else. A lead is a brand, not a person, and stays.
 * Idempotent: a second run finds the mailbox already `erasing` (or gone) and deletes nothing more.
 */

/** Returns the number of rows removed or changed. Takes a connection so the caller can add to it. */
export async function eraseSpambankMailbox(
  client: pg.PoolClient | pg.Pool,
  userId: string,
): Promise<number> {
  const found = await client.query<{ id: string; local_part: string }>(
    `SELECT id, local_part FROM spambank.mailbox WHERE user_id = $1 FOR UPDATE`,
    [userId],
  );
  const mailbox = found.rows[0];
  if (mailbox === undefined) return 0;
  let records = 0;
  // Retire the name first: a name that was ever given out is never given out again.
  const retired = await client.query(
    `INSERT INTO spambank.retired_name (local_part) VALUES ($1) ON CONFLICT DO NOTHING`,
    [mailbox.local_part],
  );
  records += retired.rowCount ?? 0;
  for (const table of ["lead_sighting", "statement_offer", "unsubscribe", "ingested_message"]) {
    const deleted = await client.query(`DELETE FROM spambank.${table} WHERE mailbox_id = $1`, [
      mailbox.id,
    ]);
    records += deleted.rowCount ?? 0;
  }
  const marked = await client.query(
    `UPDATE spambank.mailbox SET status = 'erasing', updated_at = now()
      WHERE id = $1 AND status <> 'erasing'`,
    [mailbox.id],
  );
  return records + (marked.rowCount ?? 0);
}

/** The registry entry: runs `eraseSpambankMailbox` in its own transaction. */
export function eraseSpambank(pool: pg.Pool): DomainHandler {
  return async (subjectId: string): Promise<number> => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const records = await eraseSpambankMailbox(client, subjectId);
      await client.query("COMMIT");
      return records;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  };
}
