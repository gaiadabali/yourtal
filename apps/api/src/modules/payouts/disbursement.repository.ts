import { sql } from "drizzle-orm";
import type { DisbursementStatus } from "@yourtal/contracts/billing/payouts";
import type { AppDb } from "../../shared/persistence/drizzle-client";

export const DISBURSEMENTS = Symbol("DISBURSEMENTS");

export interface DisbursementRow {
  readonly id: string;
  readonly statementId: string;
  readonly proposalId: string;
  readonly businessId: string;
  readonly region: "AU";
  readonly currency: "AUD";
  readonly amountMinor: number;
  readonly status: DisbursementStatus;
  readonly failureCode: string | null;
  readonly attempt: number;
  readonly bankLast4: string | null;
  readonly createdAt: string;
  readonly transferredAt: string | null;
  readonly paidAt: string | null;
  readonly failedAt: string | null;
  readonly checkedAt: string | null;
}

/** What the processor said became of one payout. */
export interface PayoutOutcome {
  readonly accountRef: string;
  readonly payoutRef: string;
  /** Our `disbursement:<id>:<attempt>`, when the payout was one of ours. */
  readonly reference: string | null;
  readonly outcome: "paid" | "failed";
  readonly failureCode: string | null;
}

const REFERENCE = /^disbursement:([0-9a-f-]{36}):([1-9][0-9]*)$/i;

/**
 * `payment.disbursement`, as the API sees it: reads for Studio and the staff
 * console, and the payout's outcome from the webhook. The worker
 * (settlement-disburse) creates the rows and moves the money.
 */
export class DisbursementRepository {
  constructor(private readonly db: AppDb) {}

  async listForBusiness(businessId: string): Promise<DisbursementRow[]> {
    const { rows } = await this.db.execute(sql`
      SELECT * FROM payment.disbursement WHERE business_id = ${businessId}
       ORDER BY created_at DESC LIMIT 200`);
    return rows.map(toRow);
  }

  async findOne(id: string): Promise<DisbursementRow | null> {
    const { rows } = await this.db.execute(
      sql`SELECT * FROM payment.disbursement WHERE id = ${id}::uuid`,
    );
    return rows[0] === undefined ? null : toRow(rows[0]);
  }

  async listForRegion(region: "AU" | "ID"): Promise<DisbursementRow[]> {
    const { rows } = await this.db.execute(sql`
      SELECT * FROM payment.disbursement WHERE region = ${region}
       ORDER BY created_at DESC LIMIT 500`);
    return rows.map(toRow);
  }

  /**
   * Applies a payout's outcome once: only to the attempt that sent it, and
   * only while it is still in flight. Matched by the payout id, or by our
   * reference when the worker had not stored that id yet. False when the
   * payout is not one of ours (a charity's daily payout) or was already applied.
   */
  async settlePayout(outcome: PayoutOutcome): Promise<boolean> {
    const set =
      outcome.outcome === "paid"
        ? sql`status = 'paid', paid_at = now()`
        : sql`status = 'failed', failure_code = ${outcome.failureCode ?? "payout_failed"}, failed_at = now()`;
    const byRef = await this.db.execute(sql`
      UPDATE payment.disbursement SET ${set}, updated_at = now()
       WHERE payout_ref = ${outcome.payoutRef} AND account_ref = ${outcome.accountRef}
         AND status = 'transferred'
      RETURNING id`);
    if (byRef.rows.length > 0) return true;

    const ours = REFERENCE.exec(outcome.reference ?? "");
    if (ours === null) return false;
    const byReference = await this.db.execute(sql`
      UPDATE payment.disbursement SET ${set}, payout_ref = ${outcome.payoutRef}, updated_at = now()
       WHERE id = ${ours[1]}::uuid AND attempt = ${Number(ours[2])}
         AND payout_ref IS NULL AND account_ref = ${outcome.accountRef} AND status = 'transferred'
      RETURNING id`);
    return byReference.rows.length > 0;
  }
}

const iso = (value: unknown): string | null =>
  value === null || value === undefined ? null : new Date(value as string).toISOString();

function toRow(row: Record<string, unknown>): DisbursementRow {
  return {
    id: String(row["id"]),
    statementId: String(row["statement_id"]),
    proposalId: String(row["proposal_id"]),
    businessId: String(row["business_id"]),
    region: "AU",
    currency: "AUD",
    amountMinor: Number(row["amount_minor"]),
    status: row["status"] as DisbursementStatus,
    failureCode: typeof row["failure_code"] === "string" ? row["failure_code"] : null,
    attempt: Number(row["attempt"]),
    bankLast4: typeof row["bank_last4"] === "string" ? row["bank_last4"] : null,
    createdAt: iso(row["created_at"]) ?? new Date(0).toISOString(),
    transferredAt: iso(row["transferred_at"]),
    paidAt: iso(row["paid_at"]),
    failedAt: iso(row["failed_at"]),
    checkedAt: iso(row["payout_checked_at"]),
  };
}
