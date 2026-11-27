import type { AutoreplyMode } from "@yourtal/contracts/spambank/common";
import type { Queryable } from "../ingest/db";
import { AUTOREPLY_MAX_AGE_MS } from "../ingest/process-message";

/**
 * T6's follow-up: an `ingested_message` left `queued` whose `spambank.autoreply` job was lost (the worker
 * stopped between ingest's commit and the send, the queue was down, Stalwart could not be read) would
 * never be decided. Every 5 minutes:
 *
 * - with the hard switch `off`, every `queued` row is decided `disabled`;
 * - a `queued` row past the 48-hour window is decided `stale` (check 1 would refuse it anyway);
 * - a `queued` row older than 5 minutes is handed back for a new job (the job is idempotent);
 * - a reply claimed more than an hour ago and never marked sent or failed (a crash mid-send) is marked
 *   `send_failed`: it may or may not have gone, and it is never sent again (at most once).
 */

export const REQUEUE_AFTER_MS = 5 * 60 * 1000;
const INTERRUPTED_AFTER_MS = 60 * 60 * 1000;
const REQUEUE_MAX = 200;

export interface SweepResult {
  readonly disabled: number;
  readonly stale: number;
  readonly interrupted: number;
  readonly requeue: readonly { readonly mailboxId: string; readonly emailId: string }[];
}

export async function sweepAutoreplies(
  db: Queryable,
  mode: AutoreplyMode,
  now: Date,
): Promise<SweepResult> {
  if (mode === "off") {
    const off = await db.query(
      `UPDATE spambank.ingested_message SET autoreply_decision = 'disabled'
        WHERE autoreply_decision = 'queued'`,
    );
    return { disabled: off.rowCount ?? 0, stale: 0, interrupted: 0, requeue: [] };
  }
  const stale = await db.query(
    `UPDATE spambank.ingested_message SET autoreply_decision = 'stale'
      WHERE autoreply_decision = 'queued' AND received_at < $1`,
    [new Date(now.getTime() - AUTOREPLY_MAX_AGE_MS)],
  );
  const cutoff = new Date(now.getTime() - INTERRUPTED_AFTER_MS);
  const interrupted = await db.query(
    `UPDATE spambank.autoreply SET status = 'send_failed',
            error = 'interrupted: the worker stopped while sending; not retried'
      WHERE status = 'queued' AND created_at < $1`,
    [cutoff],
  );
  await db.query(
    `UPDATE spambank.ingested_message m SET autoreply_decision = 'send_failed'
       FROM spambank.autoreply a
      WHERE m.autoreply_decision = 'sending' AND a.source_mailbox_id = m.mailbox_id
        AND a.source_email_id = m.email_id AND a.status = 'send_failed'`,
  );
  const { rows } = await db.query<{ mailbox_id: string; email_id: string }>(
    `SELECT mailbox_id, email_id FROM spambank.ingested_message
      WHERE autoreply_decision = 'queued' AND processed_at < $1
      ORDER BY processed_at LIMIT ${String(REQUEUE_MAX)}`,
    [new Date(now.getTime() - REQUEUE_AFTER_MS)],
  );
  return {
    disabled: 0,
    stale: stale.rowCount ?? 0,
    interrupted: interrupted.rowCount ?? 0,
    requeue: rows.map((row) => ({ mailboxId: row.mailbox_id, emailId: row.email_id })),
  };
}
