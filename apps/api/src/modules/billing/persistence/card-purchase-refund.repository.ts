import { sql } from "drizzle-orm";
import type { Currency } from "@yourtal/contracts/money/currency";
import type { Region } from "@yourtal/contracts/region";
import type { AppDb } from "../../../shared/persistence/drizzle-client";

export const CARD_PURCHASE_REFUNDS = Symbol("CARD_PURCHASE_REFUNDS");

/** A card purchase staff must settle (`needs_review`) or have refunded, with what a refund needs. */
export interface ParkedPurchaseRow {
  readonly id: string;
  readonly businessId: string;
  readonly businessName: string | null;
  readonly region: Region;
  readonly currency: Currency;
  readonly tierKey: string | null;
  readonly points: number;
  readonly subtotalMinor: number;
  readonly taxMinor: number;
  readonly totalMinor: number;
  readonly provider: "stripe" | "simulated";
  readonly status: "needs_review" | "refunded";
  readonly reviewReason: string;
  readonly paymentRef: string | null;
  readonly paidAt: Date | null;
  readonly refundProposalId: string | null;
  readonly refundRequestedBy: string | null;
  readonly refundRef: string | null;
  readonly refundedAt: Date | null;
}

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const date = (value: unknown): Date | null =>
  value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;

function toRow(row: Record<string, unknown>): ParkedPurchaseRow {
  return {
    id: String(row["id"]),
    businessId: String(row["business_id"]),
    businessName: text(row["legal_name"]),
    region: row["region"] as Region,
    currency: row["currency"] as Currency,
    tierKey: text(row["tier_key"]),
    points: Number(row["points"]),
    subtotalMinor: Number(row["subtotal_minor"]),
    taxMinor: Number(row["tax_minor"]),
    totalMinor: Number(row["total_minor"]),
    provider: row["provider"] as ParkedPurchaseRow["provider"],
    status: row["status"] as ParkedPurchaseRow["status"],
    reviewReason: String(row["review_reason"]),
    paymentRef: text(row["payment_ref"]),
    paidAt: date(row["paid_at"]),
    refundProposalId: text(row["refund_proposal_id"]),
    refundRequestedBy: text(row["refund_requested_by"]),
    refundRef: text(row["refund_ref"]),
    refundedAt: date(row["refunded_at"]),
  };
}

const SELECT = sql`
  SELECT p.*, b.legal_name
    FROM payment.card_purchase p
    LEFT JOIN business.business_accounts b ON b.id = p.business_id`;

/**
 * 5.1.g (F123): the refund side of `payment.card_purchase`. Every change is
 * conditional on the purchase still being parked (or already refunded by the
 * same proposal), so a replayed approval or webhook changes nothing, and a
 * purchase is claimed by one proposal only (a unique index backs that).
 */
export class CardPurchaseRefundRepository {
  constructor(private readonly db: AppDb) {}

  /** Parked purchases oldest payment first, then the last 50 refunded, newest first. */
  async listParked(region: Region): Promise<ParkedPurchaseRow[]> {
    const parked = await this.db.execute(sql`
      ${SELECT} WHERE p.region = ${region} AND p.status = 'needs_review'
       ORDER BY p.paid_at NULLS FIRST, p.id LIMIT 200`);
    const refunded = await this.db.execute(sql`
      ${SELECT} WHERE p.region = ${region} AND p.status = 'refunded'
       ORDER BY p.refunded_at DESC, p.id LIMIT 50`);
    return [...parked.rows, ...refunded.rows].map(toRow);
  }

  /** A parked or refunded purchase; null for any other state or none. */
  async findParked(id: string): Promise<ParkedPurchaseRow | null> {
    const { rows } = await this.db.execute(sql`
      ${SELECT} WHERE p.id = ${id} AND p.status IN ('needs_review', 'refunded')`);
    return rows[0] === undefined ? null : toRow(rows[0]);
  }

  /**
   * Written before the processor is called: this proposal, and the approving
   * staff member, now own the refund. False when the purchase is no longer
   * parked, has no payment to refund, or another proposal owns it.
   */
  async claim(id: string, proposalId: string, approvedBy: string): Promise<boolean> {
    const { rows } = await this.db.execute(sql`
      UPDATE payment.card_purchase
         SET refund_proposal_id = ${proposalId}::uuid,
             refund_requested_by = coalesce(refund_requested_by, ${approvedBy})
       WHERE id = ${id} AND status = 'needs_review' AND payment_ref IS NOT NULL
         AND (refund_proposal_id IS NULL OR refund_proposal_id = ${proposalId}::uuid)
      RETURNING id`);
    return rows.length > 0;
  }

  /**
   * A refund the processor definitively refused, or a proposal withdrawn before
   * any call: the purchase is free to be proposed again. Never once a refund
   * exists (refund_ref set) or the purchase is refunded.
   */
  async release(id: string, proposalId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE payment.card_purchase
         SET refund_proposal_id = NULL, refund_requested_by = NULL
       WHERE id = ${id} AND refund_proposal_id = ${proposalId}::uuid
         AND status = 'needs_review' AND refund_ref IS NULL`);
  }

  /** The processor took the refund: the purchase is refunded. Idempotent; false if another proposal owns it. */
  async finish(id: string, proposalId: string, refundRef: string): Promise<boolean> {
    const { rows } = await this.db.execute(sql`
      UPDATE payment.card_purchase
         SET status = 'refunded', refund_ref = coalesce(refund_ref, ${refundRef}),
             refunded_at = coalesce(refunded_at, now())
       WHERE id = ${id} AND refund_proposal_id = ${proposalId}::uuid
         AND status IN ('needs_review', 'refunded')
      RETURNING id`);
    return rows.length > 0;
  }

  /**
   * refund.succeeded: settles the purchase only when staff asked for this
   * refund (it is claimed). A refund made elsewhere, possibly partial, is left
   * for staff to see. True when a row changed.
   */
  async settleFromEvent(paymentRef: string, refundRef: string): Promise<boolean> {
    const { rows } = await this.db.execute(sql`
      UPDATE payment.card_purchase
         SET status = 'refunded', refund_ref = coalesce(refund_ref, ${refundRef}),
             refunded_at = coalesce(refunded_at, now())
       WHERE payment_ref = ${paymentRef} AND status = 'needs_review'
         AND refund_requested_by IS NOT NULL
         AND (refund_ref IS NULL OR refund_ref = ${refundRef})
      RETURNING id`);
    return rows.length > 0;
  }
}
