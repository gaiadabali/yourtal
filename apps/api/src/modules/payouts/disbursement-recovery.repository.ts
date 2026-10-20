import { sql } from "drizzle-orm";
import type { PayoutDetails } from "@yourtal/drivers/payout-accounts";
import type { AppDb } from "../../shared/persistence/drizzle-client";

export const DISBURSEMENT_RECOVERY = Symbol("DISBURSEMENT_RECOVERY");

/** What staff need of a disbursement to ask the processor about it. */
export interface DisbursementRecord {
  readonly id: string;
  readonly statementId: string;
  readonly region: "AU";
  readonly amountMinor: number;
  readonly status: "queued" | "awaiting_account" | "transferred" | "paid" | "failed";
  readonly failureCode: string | null;
  readonly attempt: number;
  readonly accountRef: string | null;
  readonly transferRef: string | null;
  readonly payoutRef: string | null;
  readonly createdAt: Date;
}

function toRecord(row: Record<string, unknown>): DisbursementRecord {
  const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
  return {
    id: String(row["id"]),
    statementId: String(row["statement_id"]),
    region: "AU",
    amountMinor: Number(row["amount_minor"]),
    status: row["status"] as DisbursementRecord["status"],
    failureCode: text(row["failure_code"]),
    attempt: Number(row["attempt"]),
    accountRef: text(row["account_ref"]),
    transferRef: text(row["transfer_ref"]),
    payoutRef: text(row["payout_ref"]),
    createdAt: new Date(String(row["created_at"])),
  };
}

/**
 * 5.2.c: what staff's "check again" writes to `payment.disbursement`, always
 * conditional on the row still being where staff saw it (failed, same attempt),
 * so a second click or a job run in between changes nothing. It records what
 * the processor shows; it never sends money (the job does, under the approval
 * the statement already has).
 */
export class DisbursementRecoveryRepository {
  constructor(private readonly db: AppDb) {}

  async find(id: string): Promise<DisbursementRecord | null> {
    const { rows } = await this.db.execute(
      sql`SELECT * FROM payment.disbursement WHERE id = ${id}::uuid`,
    );
    return rows[0] === undefined ? null : toRecord(rows[0]);
  }

  /** The processor shows the transfer: the row is transferred, and the job pays it out next. */
  async adoptTransfer(row: DisbursementRecord, transferRef: string): Promise<boolean> {
    const { rows } = await this.db.execute(sql`
      UPDATE payment.disbursement
         SET transfer_ref = ${transferRef}, status = 'transferred',
             transferred_at = coalesce(transferred_at, now()),
             failure_code = NULL, failed_at = NULL, payout_requested_at = NULL,
             payout_checked_at = now(), updated_at = now()
       WHERE id = ${row.id}::uuid AND status = 'failed' AND attempt = ${row.attempt}
         AND transfer_ref IS NULL
      RETURNING id`);
    return rows.length > 0;
  }

  /** The processor shows the payout: paid, still on its way (the webhook or the read-back settles it), or failed. */
  async adoptPayout(row: DisbursementRecord, payout: PayoutDetails): Promise<boolean> {
    const set =
      payout.status === "paid"
        ? sql`status = 'paid', paid_at = now(), failure_code = NULL, failed_at = NULL`
        : payout.status === "pending"
          ? sql`status = 'transferred', failure_code = NULL, failed_at = NULL`
          : sql`status = 'failed', failure_code = ${payout.failureCode ?? "payout_failed"}, failed_at = now()`;
    const { rows } = await this.db.execute(sql`
      UPDATE payment.disbursement
         SET ${set}, payout_ref = ${payout.payoutRef}, payout_checked_at = now(), updated_at = now()
       WHERE id = ${row.id}::uuid AND status = 'failed' AND attempt = ${row.attempt}
         AND (payout_ref IS NULL OR payout_ref = ${payout.payoutRef}) AND transfer_ref IS NOT NULL
      RETURNING id`);
    return rows.length > 0;
  }

  /** The processor shows nothing: noted, so staff see when it was last asked. */
  async touchChecked(id: string): Promise<void> {
    await this.db.execute(
      sql`UPDATE payment.disbursement SET payout_checked_at = now() WHERE id = ${id}::uuid`,
    );
  }
}
