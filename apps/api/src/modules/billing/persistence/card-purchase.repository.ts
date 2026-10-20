import { sql } from "drizzle-orm";
import type { CardPurchase, CardPurchaseStatus } from "@yourtal/contracts/billing";
import type { Currency } from "@yourtal/contracts/money/currency";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";
import type { Region } from "@yourtal/contracts/region";
import type { AppDb } from "../../../shared/persistence/drizzle-client";

export const BILLING_DB = Symbol("BILLING_DB");
export const CARD_PURCHASES = Symbol("CARD_PURCHASES");

export interface CardPurchaseRow {
  readonly id: string;
  readonly businessId: string;
  readonly region: Region;
  readonly currency: Currency;
  readonly points: number;
  readonly subtotalMinor: number;
  readonly taxMinor: number;
  readonly totalMinor: number;
  readonly taxRateBps: number;
  readonly idempotencyKey: string;
  readonly provider: "stripe" | "simulated";
  readonly checkoutRef: string | null;
  readonly checkoutExpiresAt: Date;
  readonly status: CardPurchaseStatus;
  readonly allocationId: string | null;
  readonly createdAt: Date;
  readonly paidAt: Date | null;
}

export type NewCardPurchase = Pick<
  CardPurchaseRow,
  | "businessId"
  | "region"
  | "currency"
  | "points"
  | "subtotalMinor"
  | "taxMinor"
  | "totalMinor"
  | "taxRateBps"
  | "idempotencyKey"
  | "provider"
  | "checkoutExpiresAt"
>;

/** States a payment may still settle from: a session can report paid after we saw it expire. */
const OPEN = sql`status IN ('pending', 'expired')`;

/** `payment.card_purchase`, raw SQL. Every status change is conditional, so a replay changes nothing. */
export class CardPurchaseRepository {
  constructor(private readonly db: AppDb) {}

  /** Inserts once per idempotency key; a repeat returns the row the first call wrote. */
  async insertOnce(purchase: NewCardPurchase): Promise<CardPurchaseRow> {
    await this.db.execute(sql`
      INSERT INTO payment.card_purchase
        (business_id, region, currency, points, subtotal_minor, tax_minor, total_minor, tax_rate_bps,
         idempotency_key, provider, checkout_expires_at)
      VALUES (${purchase.businessId}, ${purchase.region}, ${purchase.currency}, ${purchase.points},
              ${purchase.subtotalMinor}, ${purchase.taxMinor}, ${purchase.totalMinor},
              ${purchase.taxRateBps}, ${purchase.idempotencyKey}, ${purchase.provider},
              ${purchase.checkoutExpiresAt.toISOString()})
      ON CONFLICT (idempotency_key) DO NOTHING`);
    const row = await this.findByKey(purchase.idempotencyKey);
    if (row === null) throw new Error("card purchase insert returned no row");
    return row;
  }

  async findByKey(idempotencyKey: string): Promise<CardPurchaseRow | null> {
    const { rows } = await this.db.execute(
      sql`SELECT * FROM payment.card_purchase WHERE idempotency_key = ${idempotencyKey}`,
    );
    return rows[0] === undefined ? null : toRow(rows[0]);
  }

  async find(id: string): Promise<CardPurchaseRow | null> {
    const { rows } = await this.db.execute(
      sql`SELECT * FROM payment.card_purchase WHERE id = ${id}`,
    );
    return rows[0] === undefined ? null : toRow(rows[0]);
  }

  async attachCheckout(id: string, checkoutRef: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE payment.card_purchase SET checkout_ref = ${checkoutRef}
       WHERE id = ${id} AND checkout_ref IS NULL`);
  }

  async markPaid(id: string, paymentRef: string | null, allocationId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE payment.card_purchase
         SET status = 'paid', payment_ref = ${paymentRef}, allocation_id = ${allocationId}, paid_at = now()
       WHERE id = ${id} AND ${OPEN}`);
  }

  async markNeedsReview(id: string, paymentRef: string | null, reason: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE payment.card_purchase
         SET status = 'needs_review', payment_ref = ${paymentRef}, review_reason = ${reason}, paid_at = now()
       WHERE id = ${id} AND ${OPEN}`);
  }

  async markExpired(id: string): Promise<void> {
    await this.db.execute(
      sql`UPDATE payment.card_purchase SET status = 'expired' WHERE id = ${id} AND status = 'pending'`,
    );
  }
}

function toRow(row: Record<string, unknown>): CardPurchaseRow {
  const date = (value: unknown) => new Date(String(value));
  return {
    id: String(row["id"]),
    businessId: String(row["business_id"]),
    region: row["region"] as Region,
    currency: row["currency"] as Currency,
    points: Number(row["points"]),
    subtotalMinor: Number(row["subtotal_minor"]),
    taxMinor: Number(row["tax_minor"]),
    totalMinor: Number(row["total_minor"]),
    taxRateBps: Number(row["tax_rate_bps"]),
    idempotencyKey: String(row["idempotency_key"]),
    provider: row["provider"] as CardPurchaseRow["provider"],
    checkoutRef: row["checkout_ref"] === null ? null : String(row["checkout_ref"]),
    checkoutExpiresAt: date(row["checkout_expires_at"]),
    status: row["status"] as CardPurchaseStatus,
    allocationId: row["allocation_id"] === null ? null : String(row["allocation_id"]),
    createdAt: date(row["created_at"]),
    paidAt: row["paid_at"] === null ? null : date(row["paid_at"]),
  };
}

/** The Studio view: no provider refs, no key, no review reason. */
export function toCardPurchase(row: CardPurchaseRow): CardPurchase {
  return {
    purchaseId: row.id,
    status: row.status,
    points: toPoints(row.points),
    subtotalMinor: toMinorUnits(row.subtotalMinor),
    taxMinor: toMinorUnits(row.taxMinor),
    totalMinor: toMinorUnits(row.totalMinor),
    taxRateBps: row.taxRateBps,
    currency: row.currency,
    allocationId: row.allocationId,
    createdAt: row.createdAt.toISOString(),
    paidAt: row.paidAt === null ? null : row.paidAt.toISOString(),
  };
}
