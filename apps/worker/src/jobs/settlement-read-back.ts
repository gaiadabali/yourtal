import type { Pool } from "pg";
import type { PayoutAccountsDriver } from "@yourtal/drivers/payout-accounts";

/** A payout with no webhook outcome this long is asked about; Stripe's usual answer arrives well inside it. */
const SILENT_AFTER = "3 hours";
/** And then at most this often, so a payout that takes days is not read every five minutes. */
const READ_EVERY = "1 hour";
const BATCH = 50;

export interface ReadBackCounts {
  readonly readPaid: number;
  readonly readFailed: number;
  readonly readPending: number;
  /** The processor could not be read, or disagrees with the row (amount): left for staff. */
  readonly readUnknown: number;
}

interface Silent {
  readonly id: string;
  readonly attempt: number;
  readonly account_ref: string;
  readonly payout_ref: string;
  readonly amount_minor: string;
}

/**
 * 5.2.c: a payout is never in flight unseen. Webhooks settle a payout, but one
 * that never arrives would leave the row `transferred` for good; so a payout
 * sent more than a few hours ago with no outcome is read back from the
 * processor and settled as paid or failed, exactly as the webhook would (same
 * guards: only the attempt that sent it, only while it is still in flight).
 * One still pending at the processor stays as it is. Money is never moved here.
 */
export async function readBackInFlight(
  db: Pool,
  driver: PayoutAccountsDriver,
): Promise<ReadBackCounts> {
  const counts = { readPaid: 0, readFailed: 0, readPending: 0, readUnknown: 0 };
  const { rows } = await db.query<Silent>(
    `SELECT id, attempt, account_ref, payout_ref, amount_minor::text AS amount_minor
       FROM payment.disbursement
      WHERE region = 'AU' AND status = 'transferred'
        AND payout_ref IS NOT NULL AND account_ref IS NOT NULL
        AND coalesce(payout_requested_at, transferred_at) < now() - interval '${SILENT_AFTER}'
        AND (payout_checked_at IS NULL OR payout_checked_at < now() - interval '${READ_EVERY}')
      ORDER BY payout_checked_at NULLS FIRST, created_at
      LIMIT ${String(BATCH)}`,
  );
  for (const row of rows) {
    const read = await driver.getPayout(row.account_ref, row.payout_ref);
    // Checked now, whatever the answer: an outage must not be asked again every five minutes.
    await db.query(`UPDATE payment.disbursement SET payout_checked_at = now() WHERE id = $1`, [
      row.id,
    ]);
    if (read.isErr()) {
      counts.readUnknown += 1;
      continue;
    }
    const payout = read.value;
    if (
      payout.payoutRef !== row.payout_ref ||
      payout.currency !== "AUD" ||
      String(payout.amountMinor) !== row.amount_minor
    ) {
      counts.readUnknown += 1;
      continue;
    }
    if (payout.status === "pending") {
      counts.readPending += 1;
      continue;
    }
    const settled = await db.query(
      payout.status === "paid"
        ? `UPDATE payment.disbursement SET status = 'paid', paid_at = now(), updated_at = now()
            WHERE id = $1 AND attempt = $2 AND payout_ref = $3 AND status = 'transferred'`
        : `UPDATE payment.disbursement
              SET status = 'failed', failure_code = $4, failed_at = now(), updated_at = now()
            WHERE id = $1 AND attempt = $2 AND payout_ref = $3 AND status = 'transferred'`,
      payout.status === "paid"
        ? [row.id, row.attempt, row.payout_ref]
        : [row.id, row.attempt, row.payout_ref, payout.failureCode ?? "payout_failed"],
    );
    // A webhook that settled it first changed nothing here, and is not counted twice.
    if ((settled.rowCount ?? 0) > 0) {
      if (payout.status === "paid") counts.readPaid += 1;
      else counts.readFailed += 1;
    }
  }
  return counts;
}
