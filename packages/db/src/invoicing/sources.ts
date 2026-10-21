import * as z from "zod";
import { taxMinorOf } from "@yourtal/contracts/money/tax";
import type { InvoiceSourceKind } from "@yourtal/contracts/invoice";
import { boostLine, pointsLine, receiptPointsLine } from "./format";
import { gstRateBps } from "./settings";
import type { InvoiceSourceRef, Queryable, SkipReason, SourceFacts } from "./types";

/** Only AU issues invoices while Indonesia is a demo (F104); ID takes real money later. */
export const INVOICED_REGIONS: readonly ("AU" | "ID")[] = ["AU"];

// Postgres hands bigint columns back as strings.
const bigintValue = z.union([z.string(), z.number()]).transform(Number);
const region = z.enum(["AU", "ID"]);
const currency = z.enum(["AUD", "IDR"]);

const cardRow = z.object({
  business_id: z.string(),
  region,
  currency,
  points: bigintValue,
  programme: z.enum(["receipts"]).nullable(),
  subtotal_minor: bigintValue,
  tax_minor: bigintValue,
  total_minor: bigintValue,
  tax_rate_bps: z.number(),
  payment_ref: z.string().nullable(),
  status: z.string(),
});

const boostRow = z.object({
  business_id: z.string(),
  region,
  currency,
  subtotal_minor: bigintValue,
  tax_minor: bigintValue,
  total_minor: bigintValue,
  tax_rate_bps: z.number(),
  provider_reference: z.string().nullable(),
  status: z.string(),
  first_day: z.string(),
  last_day: z.string(),
  title: z.string().nullable(),
});

const proposalRow = z.object({
  region,
  status: z.string(),
  payload: z.object({
    businessId: z.string(),
    points: z.number().int().positive(),
    paidMinor: z.number().int().positive(),
    currency,
    bankReference: z.string().optional(),
  }),
});

export type SourceResult =
  | { readonly ok: true; readonly facts: SourceFacts }
  | { readonly ok: false; readonly reason: SkipReason };

const notFound: SourceResult = { ok: false, reason: "source_not_found" };
const notPaid: SourceResult = { ok: false, reason: "not_paid" };
const invalid: SourceResult = { ok: false, reason: "source_invalid" };
const REGION_CURRENCY = { AU: "AUD", ID: "IDR" } as const;

async function cardPurchase(db: Queryable, id: string): Promise<SourceResult> {
  const { rows } = await db.query(
    `SELECT business_id::text, region, currency, points::text, programme, subtotal_minor::text,
            tax_minor::text, total_minor::text, tax_rate_bps, payment_ref, status
       FROM payment.card_purchase WHERE id = $1`,
    [id],
  );
  if (rows[0] === undefined) return notFound;
  const row = cardRow.parse(rows[0]);
  if (row.status !== "paid") return notPaid;
  return {
    ok: true,
    facts: {
      region: row.region,
      businessId: row.business_id,
      currency: row.currency,
      subtotalMinor: row.subtotal_minor,
      taxMinor: row.tax_minor,
      totalMinor: row.total_minor,
      taxRateBps: row.tax_rate_bps,
      paymentRef: row.payment_ref,
      description:
        row.programme === "receipts"
          ? receiptPointsLine(row.points, row.region)
          : pointsLine(row.points),
    },
  };
}

async function boostBatch(db: Queryable, id: string): Promise<SourceResult> {
  const { rows } = await db.query(
    `SELECT b.business_id::text, b.region, b.currency, b.subtotal_minor::text,
            b.tax_minor::text, b.total_minor::text, b.tax_rate_bps, b.provider_reference,
            b.status, b.first_day::text, b.last_day::text, c.title
       FROM feed.boost_charge_batch b
       LEFT JOIN campaign.campaigns c ON c.id = b.campaign_id
      WHERE b.id = $1`,
    [id],
  );
  if (rows[0] === undefined) return notFound;
  const row = boostRow.parse(rows[0]);
  if (row.status !== "charged") return notPaid;
  return {
    ok: true,
    facts: {
      region: row.region,
      businessId: row.business_id,
      currency: row.currency,
      subtotalMinor: row.subtotal_minor,
      taxMinor: row.tax_minor,
      totalMinor: row.total_minor,
      taxRateBps: row.tax_rate_bps,
      paymentRef: row.provider_reference,
      description: boostLine(row.title ?? "campaign", row.first_day, row.last_day),
    },
  };
}

/** `paidMinor` is the ex-GST subtotal; GST is added at the region's rate (F118). */
async function manualPurchase(db: Queryable, id: string): Promise<SourceResult> {
  const { rows } = await db.query(
    `SELECT region, status, payload FROM staff.economy_proposal
      WHERE id = $1 AND kind = 'manual_purchase'`,
    [id],
  );
  if (rows[0] === undefined) return notFound;
  const row = proposalRow.parse(rows[0]);
  if (row.status !== "approved") return notPaid;
  // The payload is staff-entered JSON: a currency that is not the region's is not invoiceable.
  if (row.payload.currency !== REGION_CURRENCY[row.region]) return invalid;
  const taxRateBps = await gstRateBps(db, row.region);
  const taxMinor = taxMinorOf(row.payload.paidMinor, taxRateBps);
  return {
    ok: true,
    facts: {
      region: row.region,
      businessId: row.payload.businessId,
      currency: row.payload.currency,
      subtotalMinor: row.payload.paidMinor,
      taxMinor,
      totalMinor: row.payload.paidMinor + taxMinor,
      taxRateBps,
      paymentRef: row.payload.bankReference ?? null,
      description: pointsLine(row.payload.points),
    },
  };
}

const LOADERS: Record<InvoiceSourceKind, (db: Queryable, id: string) => Promise<SourceResult>> = {
  card_purchase: cardPurchase,
  boost_batch: boostBatch,
  manual_purchase: manualPurchase,
};

/** Reads a source's own rows. Anything not yet paid, or not found, is a reason to skip, never a guess. */
export function loadSource(db: Queryable, source: InvoiceSourceRef): Promise<SourceResult> {
  return LOADERS[source.kind](db, source.id);
}

/** A source the job could not invoice sits out this long before it is tried again. */
export const SKIP_COOLDOWN_HOURS = 6;

/**
 * Paid AU sources with no invoice yet, oldest first, leaving out those skipped
 * within the cooldown so a permanently unissuable source cannot keep a place
 * among the oldest and starve the ones behind it. The worker issues them.
 */
export async function findUninvoiced(
  db: Queryable,
  limit = 200,
  skipCooldownHours = SKIP_COOLDOWN_HOURS,
): Promise<InvoiceSourceRef[]> {
  const { rows } = await db.query<{ kind: InvoiceSourceKind; id: string }>(
    `SELECT kind, id FROM (
       SELECT 'card_purchase' AS kind, p.id::text AS id, p.paid_at AS at
         FROM payment.card_purchase p
        WHERE p.status = 'paid' AND p.region = ANY($1)
          AND NOT EXISTS (SELECT 1 FROM invoice.invoice i
                           WHERE i.source_kind = 'card_purchase' AND i.source_id = p.id)
          AND NOT EXISTS (SELECT 1 FROM invoice.issue_skip k
                           WHERE k.source_kind = 'card_purchase' AND k.source_id = p.id
                             AND k.last_tried_at > now() - make_interval(hours => $3))
       UNION ALL
       SELECT 'boost_batch', b.id::text, COALESCE(b.decided_at, b.created_at)
         FROM feed.boost_charge_batch b
        WHERE b.status = 'charged' AND b.region = ANY($1)
          AND NOT EXISTS (SELECT 1 FROM invoice.invoice i
                           WHERE i.source_kind = 'boost_batch' AND i.source_id = b.id)
          AND NOT EXISTS (SELECT 1 FROM invoice.issue_skip k
                           WHERE k.source_kind = 'boost_batch' AND k.source_id = b.id
                             AND k.last_tried_at > now() - make_interval(hours => $3))
       UNION ALL
       SELECT 'manual_purchase', e.id::text, COALESCE(e.decided_at, e.created_at)
         FROM staff.economy_proposal e
        WHERE e.kind = 'manual_purchase' AND e.status = 'approved' AND e.region = ANY($1)
          AND NOT EXISTS (SELECT 1 FROM invoice.invoice i
                           WHERE i.source_kind = 'manual_purchase' AND i.source_id = e.id)
          AND NOT EXISTS (SELECT 1 FROM invoice.issue_skip k
                           WHERE k.source_kind = 'manual_purchase' AND k.source_id = e.id
                             AND k.last_tried_at > now() - make_interval(hours => $3))
     ) pending
     ORDER BY at, id
     LIMIT $2`,
    [INVOICED_REGIONS, limit, skipCooldownHours],
  );
  return rows.map((row) => ({ kind: row.kind, id: row.id }));
}
