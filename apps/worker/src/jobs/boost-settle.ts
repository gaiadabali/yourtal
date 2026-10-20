import type { Pool } from "pg";
import { taxMinorOf } from "@yourtal/contracts/money/tax";
import { createPaymentProviders } from "@yourtal/drivers/payment-providers";
import type { PaymentProviders } from "@yourtal/drivers/payment-providers";
import { createPool } from "../pool";
import { defineJob } from "../job";
import { cardForBoosts } from "./boost-settle-card";
import type { BoostOwner, ChargeCard } from "./boost-settle-card";

/**
 * 13.23.c / 5.1.a: charges closed days of boost spend to the business's saved
 * card, once. A day is closed when it is over on its region's clock (F16).
 * GST is added on top at the region's rate (F118). Days whose total is below
 * the processor's minimum (Stripe: A$0.50) wait and are charged together.
 *
 * A batch row is written BEFORE the card is charged and keyed on its days, so
 * a crash or a timeout after the charge retries the same key for the same
 * days next run instead of charging them again. Cash only: points and rewards
 * are never touched.
 */
let pool: Pool | undefined;
let providers: Readonly<Record<"AU" | "ID", PaymentProviders>> | undefined;

const FALLBACK_GST_RATE_BPS = { AU: 1_000, ID: 0 } as const;
const DAY_CLOSED = `s.day < (now() AT TIME ZONE CASE b.region WHEN 'AU' THEN 'Australia/Sydney'
                                                ELSE 'Asia/Jakarta' END)::date`;

interface OpenDay {
  readonly campaign_id: string;
  readonly business_id: string;
  readonly region: "AU" | "ID";
  readonly currency: "AUD" | "IDR";
  readonly day: string;
  readonly impressions: number;
  readonly spent_milli: string;
}

interface Batch {
  readonly id: string;
  readonly key: string;
  readonly owner: BoostOwner;
  readonly card: ChargeCard;
  readonly days: readonly OpenDay[];
  readonly taxRateBps: number;
  readonly totalMinor: number;
}

export interface BoostSettleResult {
  readonly charged: number;
  readonly declined: number;
  /** Below the processor's minimum; charged once more days add up. */
  readonly waiting: number;
  /** No saved card where the processor needs one. */
  readonly noCard: number;
  /** The processor could not say; the same key is tried next run. */
  readonly unsure: number;
}

async function gstRateBps(db: Pool, region: "AU" | "ID"): Promise<number> {
  const { rows } = await db.query<{ value: { rateBps?: unknown } | null }>(
    `SELECT value FROM platform.region_setting
      WHERE region = $1 AND key = 'gst_rate_bps' AND approved_by IS NOT NULL AND effective_from <= now()
      ORDER BY effective_from DESC LIMIT 1`,
    [region],
  );
  const rate = rows[0]?.value?.rateBps;
  return typeof rate === "number" && Number.isInteger(rate) && rate >= 0 && rate <= 10_000
    ? rate
    : FALLBACK_GST_RATE_BPS[region];
}

/** Closed, uncharged days with spend; `pending` picks the days a pending batch already holds. */
async function openDays(db: Pool, pending: boolean): Promise<OpenDay[]> {
  const covered = `EXISTS (SELECT 1 FROM feed.boost_charge_batch p
                            WHERE p.campaign_id = s.campaign_id AND p.status = 'pending'
                              AND s.day BETWEEN p.first_day AND p.last_day)`;
  const { rows } = await db.query<OpenDay>(`
    SELECT s.campaign_id, b.business_id, b.region, b.currency, s.day::text AS day,
           s.impressions, s.spent_milli::text AS spent_milli
      FROM feed.boost_spend_day s
      JOIN feed.boost b ON b.campaign_id = s.campaign_id
      LEFT JOIN feed.boost_charge c ON c.campaign_id = s.campaign_id AND c.day = s.day
     WHERE c.id IS NULL AND s.spent_milli > 0 AND ${DAY_CLOSED}
       AND ${pending ? "" : "NOT"} ${covered}
     ORDER BY s.campaign_id, s.day`);
  return rows;
}

function byCampaign(days: readonly OpenDay[]): Map<string, OpenDay[]> {
  const grouped = new Map<string, OpenDay[]>();
  for (const day of days)
    grouped.set(day.campaign_id, [...(grouped.get(day.campaign_id) ?? []), day]);
  return grouped;
}

/** Thousandths of a minor unit, rounded up once per day to a whole unit (as before GST). */
const daySubtotal = (day: OpenDay) => Math.ceil(Number(day.spent_milli) / 1000);

async function openBatch(
  db: Pool,
  days: readonly OpenDay[],
  taxRateBps: number,
  card: ChargeCard,
): Promise<Batch | null> {
  const first = days[0];
  const last = days[days.length - 1];
  if (first === undefined || last === undefined) return null;
  const subtotalMinor = days.reduce((sum, day) => sum + daySubtotal(day), 0);
  const taxMinor = taxMinorOf(subtotalMinor, taxRateBps);
  const key = `boost:${first.campaign_id}:${first.day}:${last.day}`;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO feed.boost_charge_batch
       (charge_key, campaign_id, business_id, region, currency, first_day, last_day,
        subtotal_minor, tax_minor, total_minor, tax_rate_bps, customer_ref, payment_method_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (charge_key) WHERE status <> 'declined' DO NOTHING
     RETURNING id`,
    [
      key,
      first.campaign_id,
      first.business_id,
      first.region,
      first.currency,
      first.day,
      last.day,
      subtotalMinor,
      taxMinor,
      subtotalMinor + taxMinor,
      taxRateBps,
      card.customerRef,
      card.paymentMethodRef,
    ],
  );
  const id = rows[0]?.id;
  return id === undefined
    ? null
    : {
        id,
        key,
        owner: ownerOf(first),
        card,
        days,
        taxRateBps,
        totalMinor: subtotalMinor + taxMinor,
      };
}

const ownerOf = (day: OpenDay): BoostOwner => ({
  businessId: day.business_id,
  region: day.region,
  currency: day.currency,
});

/** Batches an earlier run started and could not finish, with the card and amount it first sent. */
async function pendingBatches(db: Pool): Promise<Batch[]> {
  const days = byCampaign(await openDays(db, true));
  const { rows } = await db.query<{
    id: string;
    charge_key: string;
    campaign_id: string;
    business_id: string;
    region: "AU" | "ID";
    currency: "AUD" | "IDR";
    first_day: string;
    last_day: string;
    total_minor: string;
    tax_rate_bps: number;
    customer_ref: string;
    payment_method_ref: string;
  }>(`SELECT id, charge_key, campaign_id, business_id, region, currency, first_day::text,
             last_day::text, total_minor::text, tax_rate_bps, customer_ref, payment_method_ref
        FROM feed.boost_charge_batch WHERE status = 'pending'`);
  return rows.map((row) => ({
    id: row.id,
    key: row.charge_key,
    owner: { businessId: row.business_id, region: row.region, currency: row.currency },
    card: { customerRef: row.customer_ref, paymentMethodRef: row.payment_method_ref },
    days: (days.get(row.campaign_id) ?? []).filter(
      (d) => d.day >= row.first_day && d.day <= row.last_day,
    ),
    taxRateBps: row.tax_rate_bps,
    totalMinor: Number(row.total_minor),
  }));
}

type Outcome = "charged" | "declined" | "unsure";

async function chargeBatch(
  db: Pool,
  batch: Batch,
  regionProviders: PaymentProviders,
): Promise<Outcome> {
  const charge = await regionProviders.payments.chargeSaved({
    idempotencyKey: batch.key,
    amountMinor: batch.totalMinor,
    currency: batch.owner.currency,
    customerRef: batch.card.customerRef,
    paymentMethodRef: batch.card.paymentMethodRef,
    reference: batch.key,
    description: "YourTal boost",
  });
  if (charge.isErr()) {
    // Not taken for certain: keep the batch, so the next run asks again under the same key.
    if (charge.error.mayHaveSucceeded) return "unsure";
    await db.query(
      `UPDATE feed.boost_charge_batch SET status = 'declined', decided_at = now() WHERE id = $1`,
      [batch.id],
    );
    return "declined";
  }
  await recordCharged(db, batch, charge.value.paymentReference);
  return "charged";
}

/** One row per day; GST is split by running total, so the days sum exactly to the batch. */
async function recordCharged(db: Pool, batch: Batch, providerReference: string): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    let running = 0;
    for (const day of batch.days) {
      const subtotal = daySubtotal(day);
      const tax =
        taxMinorOf(running + subtotal, batch.taxRateBps) - taxMinorOf(running, batch.taxRateBps);
      running += subtotal;
      await client.query(
        `INSERT INTO feed.boost_charge
           (campaign_id, business_id, region, currency, day, impressions, amount_minor,
            subtotal_minor, tax_minor, provider_reference, batch_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (campaign_id, day) DO NOTHING`,
        [
          day.campaign_id,
          day.business_id,
          day.region,
          day.currency,
          day.day,
          day.impressions,
          subtotal + tax,
          subtotal,
          tax,
          providerReference,
          batch.id,
        ],
      );
    }
    await client.query(
      `UPDATE feed.boost_charge_batch SET status = 'charged', provider_reference = $2, decided_at = now()
        WHERE id = $1`,
      [batch.id, providerReference],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function runBoostSettle(
  db: Pool,
  regionProviders: Readonly<Record<"AU" | "ID", PaymentProviders>>,
): Promise<BoostSettleResult> {
  const counts: Record<Outcome | "waiting" | "noCard", number> = {
    charged: 0,
    declined: 0,
    waiting: 0,
    noCard: 0,
    unsure: 0,
  };
  for (const batch of await pendingBatches(db)) {
    counts[await chargeBatch(db, batch, regionProviders[batch.owner.region])] += 1;
  }

  const rates = new Map<string, number>();
  for (const days of byCampaign(await openDays(db, false)).values()) {
    const first = days[0];
    if (first === undefined) continue;
    const region = regionProviders[first.region];
    const rate = rates.get(first.region) ?? (await gstRateBps(db, first.region));
    rates.set(first.region, rate);
    const subtotal = days.reduce((sum, day) => sum + daySubtotal(day), 0);
    const minimum = region.payments.minimumChargeMinor[first.currency] ?? 1;
    if (subtotal + taxMinorOf(subtotal, rate) < minimum) {
      counts.waiting += 1;
      continue;
    }
    const card = await cardForBoosts(db, ownerOf(first), region.payments);
    if (card === null) {
      counts.noCard += 1;
      continue;
    }
    const batch = await openBatch(db, days, rate, card);
    if (batch !== null) counts[await chargeBatch(db, batch, region)] += 1;
  }
  return counts;
}

export const job = defineJob({
  queue: "feed.boost_settle",
  // Hourly: each region's day closes at its own midnight, and a closed day
  // is charged within the hour after.
  schedule: "15 * * * *",
  async handle(_job, { config }) {
    pool ??= createPool(config.databaseUrl);
    providers ??= createPaymentProviders(process.env);
    await runBoostSettle(pool, providers);
  },
});
