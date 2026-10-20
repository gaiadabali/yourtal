import { randomUUID } from "node:crypto";
import type pg from "pg";

/** Rows for the invoice tests, written the way the billing code writes them. */

/** The ATO's own example ABN: it passes the checksum. */
export const VALID_ABN = "51824753556";

export interface Buyer {
  readonly id: string;
  readonly legalName: string;
}

export async function seedBusiness(
  db: pg.Pool,
  options: { region?: "AU" | "ID"; abn?: string } = {},
): Promise<Buyer> {
  const region = options.region ?? "AU";
  const id = randomUUID();
  const legalName = `Invoice Buyer ${id.slice(0, 8)} Pty Ltd`;
  await db.query(
    `INSERT INTO business.business_accounts
       (id, legal_name, display_name, tax_id_kind, tax_id_value, address_state, address_postcode,
        address_city, roles, region, currency, handle)
     VALUES ($1, $2, $2, $3, $4, $5, $6, $7, '["advertiser"]'::jsonb, $8, $9, $10)`,
    [
      id,
      legalName,
      region === "AU" ? "ABN" : "NPWP",
      options.abn ?? (region === "AU" ? "00000000000" : "1234567890123456"),
      region === "AU" ? "NSW" : null,
      region === "AU" ? "2000" : null,
      region === "AU" ? null : "Jakarta",
      region,
      region === "AU" ? "AUD" : "IDR",
      `inv-${id.slice(0, 8)}`,
    ],
  );
  return { id, legalName };
}

export interface Money {
  readonly subtotalMinor: number;
  readonly taxMinor: number;
}

export async function seedCardPurchase(
  db: pg.Pool,
  businessId: string,
  options: {
    region?: "AU" | "ID";
    points?: number;
    money?: Money;
    status?: "paid" | "pending";
  } = {},
): Promise<{ id: string } & Money & { paymentRef: string }> {
  const region = options.region ?? "AU";
  const money = options.money ?? { subtotalMinor: 45_000, taxMinor: 4_500 };
  const status = options.status ?? "paid";
  const paymentRef = `pi_${randomUUID().slice(0, 12)}`;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO payment.card_purchase
       (business_id, region, currency, points, subtotal_minor, tax_minor, total_minor, tax_rate_bps,
        idempotency_key, provider, checkout_expires_at, payment_ref, status, allocation_id, paid_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'simulated', now() + interval '1 hour', $10, $11, $12, $13)
     RETURNING id::text AS id`,
    [
      businessId,
      region,
      region === "AU" ? "AUD" : "IDR",
      options.points ?? 10_000,
      money.subtotalMinor,
      money.taxMinor,
      money.subtotalMinor + money.taxMinor,
      region === "AU" ? 1_000 : 0,
      `inv-test-${randomUUID()}`,
      paymentRef,
      status,
      status === "paid" ? "alloc-1" : null,
      status === "paid" ? new Date() : null,
    ],
  );
  return { id: rows[0]?.id ?? "", ...money, paymentRef };
}

export async function seedBoostBatch(
  db: pg.Pool,
  businessId: string,
  options: { firstDay: string; lastDay: string; money?: Money; title?: string },
): Promise<{ id: string } & Money> {
  const money = options.money ?? { subtotalMinor: 1_234, taxMinor: 123 };
  const campaignId = randomUUID();
  await db.query(
    `INSERT INTO campaign.campaigns
       (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds, reward_points,
        question_count, scoring_rule, lifecycle_state, business_id, region, audience,
        content_category, starts_at, ends_at, open_viewing, teaser_start_seconds)
     VALUES ($1, 'quick', $3, $2, 'Invoice test', 'x', 30, 3, 0, 'base_only', 'draft',
             $2, 'AU', 'all_ages', 'food-and-drink', now(), now() + interval '9 days', false, 0)`,
    [campaignId, businessId, options.title ?? "Spring menu launch"],
  );
  await db.query(
    `INSERT INTO feed.boost (campaign_id, business_id, region, currency, daily_budget_minor,
                             max_bid_cpm_minor, starts_at, ends_at, state)
     VALUES ($1, $2, 'AU', 'AUD', 100, 500, now() - interval '9 days', now() + interval '5 days', 'active')`,
    [campaignId, businessId],
  );
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO feed.boost_charge_batch
       (charge_key, campaign_id, business_id, region, currency, first_day, last_day, subtotal_minor,
        tax_minor, total_minor, tax_rate_bps, customer_ref, payment_method_ref, status,
        provider_reference, decided_at)
     VALUES ($1, $2, $3, 'AU', 'AUD', $4, $5, $6, $7, $8, 1000, 'cus_x', 'pm_x', 'charged', $9, now())
     RETURNING id::text AS id`,
    [
      `inv-test-${randomUUID()}`,
      campaignId,
      businessId,
      options.firstDay,
      options.lastDay,
      money.subtotalMinor,
      money.taxMinor,
      money.subtotalMinor + money.taxMinor,
      `ch_${randomUUID().slice(0, 12)}`,
    ],
  );
  return { id: rows[0]?.id ?? "", ...money };
}

/** A purchase staff entered by hand and a second person approved. */
export async function seedManualPurchase(
  db: pg.Pool,
  businessId: string,
  options: {
    paidMinor?: number;
    points?: number;
    currency?: "AUD" | "IDR";
    region?: "AU" | "ID";
  } = {},
): Promise<{ id: string; bankReference: string }> {
  const bankReference = `BANK-${randomUUID().slice(0, 8)}`;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO staff.economy_proposal
       (kind, region, summary, payload, proposed_by, approved_by, status, decided_at)
     VALUES ('manual_purchase', $1, 'Manual purchase', $2::jsonb, 'finance-a', 'finance-b', 'approved', now())
     RETURNING id::text AS id`,
    [
      options.region ?? "AU",
      JSON.stringify({
        businessId,
        points: options.points ?? 20_000,
        paidMinor: options.paidMinor ?? 100_000,
        currency: options.currency ?? "AUD",
        bankReference,
      }),
    ],
  );
  return { id: rows[0]?.id ?? "", bankReference };
}

/**
 * Sets the issuing company the way staff would: a new approved row, so the
 * latest wins and the old one stays as history. `abn: null` is the demo state.
 */
export async function setIssuer(
  db: pg.Pool,
  abn: string | null,
  legalName = "YourTal Demo Pty Ltd",
): Promise<void> {
  await db.query(
    `INSERT INTO platform.region_setting (region, key, value, set_by, approved_by, effective_from)
     VALUES ('AU', 'invoice_issuer', $1::jsonb, 'test-a', 'test-b', clock_timestamp())`,
    [
      JSON.stringify({
        legalName,
        abn,
        address: "Demo address only, Sydney NSW 2000",
        email: "billing@demo.yourtal.example",
      }),
    ],
  );
}
