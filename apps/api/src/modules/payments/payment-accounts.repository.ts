import { sql } from "drizzle-orm";
import type { Region } from "@yourtal/contracts/region";
import type { SavedCard } from "@yourtal/drivers/payments";
import type { AppDb } from "../../shared/persistence/drizzle-client";

export const PAYMENTS_DB = Symbol("PAYMENTS_DB");
export const PAYMENT_ACCOUNTS = Symbol("PAYMENT_ACCOUNTS");

export type Provider = "stripe" | "simulated";

/** Who a customer and a card belong to: a business now, a bidder with auctions. */
export interface PaymentOwner {
  readonly kind: "business" | "user";
  readonly id: string;
  readonly region: Region;
}

export interface StoredCard {
  readonly customerRef: string;
  readonly paymentMethodRef: string;
  readonly card: SavedCard;
}

export interface CardSetupRow {
  readonly id: string;
  readonly owner: PaymentOwner;
  readonly provider: Provider;
  readonly checkoutRef: string | null;
  readonly status: "pending" | "saved" | "expired";
}

/** `payment.customer`, `payment.saved_card`, `payment.card_setup`: raw SQL, owned by this module. */
export class PaymentAccountsRepository {
  constructor(private readonly db: AppDb) {}

  async findCustomer(owner: PaymentOwner, provider: Provider): Promise<string | null> {
    const { rows } = await this.db.execute(sql`
      SELECT customer_ref FROM payment.customer
       WHERE owner_kind = ${owner.kind} AND owner_id = ${owner.id} AND provider = ${provider}`);
    const ref = rows[0]?.["customer_ref"];
    return typeof ref === "string" ? ref : null;
  }

  /** The first stored ref wins; a concurrent second insert reads it back. */
  async saveCustomer(
    owner: PaymentOwner,
    provider: Provider,
    customerRef: string,
  ): Promise<string> {
    await this.db.execute(sql`
      INSERT INTO payment.customer (owner_kind, owner_id, region, provider, customer_ref)
      VALUES (${owner.kind}, ${owner.id}, ${owner.region}, ${provider}, ${customerRef})
      ON CONFLICT (owner_kind, owner_id, provider) DO NOTHING`);
    return (await this.findCustomer(owner, provider)) ?? customerRef;
  }

  async liveCard(owner: PaymentOwner, provider: Provider): Promise<StoredCard | null> {
    const { rows } = await this.db.execute(sql`
      SELECT customer_ref, payment_method_ref, brand, last4, exp_month, exp_year
        FROM payment.saved_card
       WHERE owner_kind = ${owner.kind} AND owner_id = ${owner.id} AND provider = ${provider}
         AND replaced_at IS NULL`);
    const row = rows[0];
    return row === undefined ? null : toStoredCard(row);
  }

  /** Makes this card the owner's live one. Saving the same card again changes nothing. */
  async replaceCard(owner: PaymentOwner, provider: Provider, stored: StoredCard): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Two deliveries for one owner queue here instead of racing the one-live-card index.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`saved_card:${owner.kind}:${owner.id}:${provider}`}))`,
      );
      const { rows } = await tx.execute(sql`
        SELECT id, payment_method_ref FROM payment.saved_card
         WHERE owner_kind = ${owner.kind} AND owner_id = ${owner.id} AND provider = ${provider}
           AND replaced_at IS NULL`);
      const live = rows[0];
      if (live?.["payment_method_ref"] === stored.paymentMethodRef) return;
      if (live !== undefined) {
        await tx.execute(
          sql`UPDATE payment.saved_card SET replaced_at = now() WHERE id = ${String(live["id"])}`,
        );
      }
      await tx.execute(sql`
        INSERT INTO payment.saved_card (owner_kind, owner_id, region, provider, customer_ref,
                                        payment_method_ref, brand, last4, exp_month, exp_year)
        VALUES (${owner.kind}, ${owner.id}, ${owner.region}, ${provider}, ${stored.customerRef},
                ${stored.paymentMethodRef}, ${stored.card.brand}, ${stored.card.last4},
                ${stored.card.expMonth}, ${stored.card.expYear})`);
    });
  }

  async createSetup(owner: PaymentOwner, provider: Provider, returnPath: string): Promise<string> {
    const { rows } = await this.db.execute(sql`
      INSERT INTO payment.card_setup (owner_kind, owner_id, region, provider, return_path)
      VALUES (${owner.kind}, ${owner.id}, ${owner.region}, ${provider}, ${returnPath})
      RETURNING id`);
    return String(rows[0]?.["id"]);
  }

  async attachSetupCheckout(id: string, checkoutRef: string): Promise<void> {
    await this.db.execute(
      sql`UPDATE payment.card_setup SET checkout_ref = ${checkoutRef} WHERE id = ${id} AND checkout_ref IS NULL`,
    );
  }

  /** By the checkout the webhook names, else by our own reference (the ref may not be stored yet). */
  async findSetup(checkoutRef: string, setupId: string | null): Promise<CardSetupRow | null> {
    const { rows } = await this.db.execute(sql`
      SELECT id, owner_kind, owner_id, region, provider, checkout_ref, status FROM payment.card_setup
       WHERE checkout_ref = ${checkoutRef}
          OR (${setupId}::uuid IS NOT NULL AND id = ${setupId}::uuid AND checkout_ref IS NULL)
       LIMIT 1`);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      id: String(row["id"]),
      owner: {
        kind: row["owner_kind"] as PaymentOwner["kind"],
        id: String(row["owner_id"]),
        region: row["region"] as Region,
      },
      provider: row["provider"] as Provider,
      checkoutRef: typeof row["checkout_ref"] === "string" ? row["checkout_ref"] : null,
      status: row["status"] as CardSetupRow["status"],
    };
  }

  async finishSetup(
    id: string,
    status: "saved" | "expired",
    checkoutRef: string | null,
  ): Promise<void> {
    await this.db.execute(sql`
      UPDATE payment.card_setup
         SET status = ${status}, completed_at = now(), checkout_ref = coalesce(checkout_ref, ${checkoutRef}::text)
       WHERE id = ${id} AND status = 'pending'`);
  }
}

function toStoredCard(row: Record<string, unknown>): StoredCard {
  return {
    customerRef: String(row["customer_ref"]),
    paymentMethodRef: String(row["payment_method_ref"]),
    card: {
      brand: String(row["brand"]),
      last4: String(row["last4"]),
      expMonth: Number(row["exp_month"]),
      expYear: Number(row["exp_year"]),
    },
  };
}
