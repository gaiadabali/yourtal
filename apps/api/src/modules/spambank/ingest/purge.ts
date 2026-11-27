import type { Queryable } from "./db";

/**
 * BUILD.md §6: ingest bookkeeping is kept for 30 days and then goes. `ingested_message` only has to outlive
 * the 48-hour window in which a message could be read twice; the statement offers and the delivered or
 * failed mail events hold nothing a month-old mail needs. Leads and their sightings are kept: they are the
 * product, and hold no message.
 */
export const RETENTION_DAYS = 30;

export interface PurgeResult {
  readonly ingestedMessages: number;
  readonly statementOffers: number;
  readonly appEvents: number;
}

export async function purgeSpambank(db: Queryable, now: Date = new Date()): Promise<PurgeResult> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const messages = await db.query("DELETE FROM spambank.ingested_message WHERE processed_at < $1", [
    cutoff,
  ]);
  const offers = await db.query("DELETE FROM spambank.statement_offer WHERE offered_at < $1", [
    cutoff,
  ]);
  // Only finished rows: one still waiting to be sent is the delivery job's to expire, not ours to drop.
  const events = await db.query(
    `DELETE FROM spambank.app_event_outbox
      WHERE iat < $1 AND (delivered_at IS NOT NULL OR failed_at IS NOT NULL)`,
    [cutoff],
  );
  return {
    ingestedMessages: messages.rowCount ?? 0,
    statementOffers: offers.rowCount ?? 0,
    appEvents: events.rowCount ?? 0,
  };
}
