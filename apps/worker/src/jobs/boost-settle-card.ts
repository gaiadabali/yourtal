import type { Pool } from "pg";
import type { PaymentsDriver } from "@yourtal/drivers/payments";

/**
 * The card a business's boosts are charged to, read the same way as the
 * API's PaymentAccountsRepository (`payment.customer`, `payment.saved_card`);
 * the worker may not import apps/api. Stripe needs a card the business saved
 * itself; the simulated driver saves one on demand, so Indonesia (and tests)
 * charge boosts exactly as before.
 */
export interface ChargeCard {
  readonly customerRef: string;
  readonly paymentMethodRef: string;
}

export interface BoostOwner {
  readonly businessId: string;
  readonly region: "AU" | "ID";
  readonly currency: "AUD" | "IDR";
}

async function liveCard(db: Pool, owner: BoostOwner, provider: string): Promise<ChargeCard | null> {
  const { rows } = await db.query<{ customer_ref: string; payment_method_ref: string }>(
    `SELECT customer_ref, payment_method_ref FROM payment.saved_card
      WHERE owner_kind = 'business' AND owner_id = $1 AND provider = $2 AND replaced_at IS NULL`,
    [owner.businessId, provider],
  );
  const row = rows[0];
  return row === undefined
    ? null
    : { customerRef: row.customer_ref, paymentMethodRef: row.payment_method_ref };
}

async function customerOf(
  db: Pool,
  owner: BoostOwner,
  driver: PaymentsDriver,
): Promise<string | null> {
  const read = async () => {
    const { rows } = await db.query<{ customer_ref: string }>(
      `SELECT customer_ref FROM payment.customer
        WHERE owner_kind = 'business' AND owner_id = $1 AND provider = $2`,
      [owner.businessId, driver.provider],
    );
    return rows[0]?.customer_ref ?? null;
  };
  const existing = await read();
  if (existing !== null) return existing;
  // Same key as the API's ensureCustomer, so both processes end with one customer.
  const created = await driver.createCustomer({
    idempotencyKey: `customer:business:${owner.businessId}`,
    reference: `business:${owner.businessId}`,
  });
  if (created.isErr()) return null;
  await db.query(
    `INSERT INTO payment.customer (owner_kind, owner_id, region, provider, customer_ref)
     VALUES ('business', $1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [owner.businessId, owner.region, driver.provider, created.value.customerRef],
  );
  return read();
}

/** The card to charge, or null when the business must add one first (Stripe) or the setup failed. */
export async function cardForBoosts(
  db: Pool,
  owner: BoostOwner,
  driver: PaymentsDriver,
): Promise<ChargeCard | null> {
  const card = await liveCard(db, owner, driver.provider);
  if (card !== null || driver.needsSavedCard) return card;

  const customerRef = await customerOf(db, owner, driver);
  if (customerRef === null) return null;
  const reference = `card-setup:boost:${owner.businessId}`;
  // The simulated driver saves at once and opens no page, so these addresses are never visited.
  const setup = await driver.startCardSetup({
    idempotencyKey: reference,
    customerRef,
    reference,
    currency: owner.currency,
    successUrl: "https://yourtal.invalid/studio/billing",
    cancelUrl: "https://yourtal.invalid/studio/billing",
  });
  if (setup.isErr() || setup.value.kind !== "saved") return null;
  const saved = setup.value;
  await db.query(
    `INSERT INTO payment.saved_card (owner_kind, owner_id, region, provider, customer_ref,
                                     payment_method_ref, brand, last4, exp_month, exp_year)
     VALUES ('business', $1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (owner_kind, owner_id, provider) WHERE replaced_at IS NULL DO NOTHING`,
    [
      owner.businessId,
      owner.region,
      driver.provider,
      customerRef,
      saved.paymentMethodRef,
      saved.card.brand,
      saved.card.last4,
      saved.card.expMonth,
      saved.card.expYear,
    ],
  );
  return liveCard(db, owner, driver.provider);
}
