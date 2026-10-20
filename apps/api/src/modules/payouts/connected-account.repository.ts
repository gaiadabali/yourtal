import { sql } from "drizzle-orm";
import type { PayoutAccount } from "@yourtal/drivers/payout-accounts";
import type { AppDb } from "../../shared/persistence/drizzle-client";

export const PAYOUTS_DB = Symbol("PAYOUTS_DB");
export const CONNECTED_ACCOUNTS = Symbol("CONNECTED_ACCOUNTS");

export type PayoutProvider = "stripe" | "simulated";

/** Who is paid out to: a brand (its statements) or a charity (its auctions' proceeds). AU only (F104). */
export interface PayoutOwner {
  readonly kind: "business" | "charity";
  readonly id: string;
  readonly region: "AU";
}

export interface ConnectedAccountRow {
  readonly owner: PayoutOwner;
  readonly provider: PayoutProvider;
  readonly accountRef: string;
  readonly chargesEnabled: boolean;
  readonly payoutsEnabled: boolean;
  readonly detailsSubmitted: boolean;
  readonly bankLast4: string | null;
}

/** `payment.connected_account`: raw SQL, owned by the payouts module. */
export class ConnectedAccountRepository {
  constructor(private readonly db: AppDb) {}

  async findByOwner(
    owner: PayoutOwner,
    provider: PayoutProvider,
  ): Promise<ConnectedAccountRow | null> {
    const { rows } = await this.db.execute(sql`
      SELECT * FROM payment.connected_account
       WHERE owner_kind = ${owner.kind} AND owner_id = ${owner.id} AND provider = ${provider}`);
    return rows[0] === undefined ? null : toRow(rows[0]);
  }

  async findByRef(accountRef: string): Promise<ConnectedAccountRow | null> {
    const { rows } = await this.db.execute(
      sql`SELECT * FROM payment.connected_account WHERE account_ref = ${accountRef}`,
    );
    return rows[0] === undefined ? null : toRow(rows[0]);
  }

  /** The first stored account wins; a concurrent second insert reads it back. */
  async save(
    owner: PayoutOwner,
    provider: PayoutProvider,
    accountRef: string,
  ): Promise<ConnectedAccountRow> {
    await this.db.execute(sql`
      INSERT INTO payment.connected_account (owner_kind, owner_id, region, provider, account_ref)
      VALUES (${owner.kind}, ${owner.id}, ${owner.region}, ${provider}, ${accountRef})
      ON CONFLICT (owner_kind, owner_id, provider) DO NOTHING`);
    const stored = await this.findByOwner(owner, provider);
    if (stored === null)
      throw new Error(`connected account for ${owner.kind} ${owner.id} vanished`);
    return stored;
  }

  /**
   * The provider's current view of the account. `updated_at` moves on every
   * write: a failed payout is sent again only once the account changed after it.
   */
  async update(account: PayoutAccount): Promise<ConnectedAccountRow | null> {
    const { rows } = await this.db.execute(sql`
      UPDATE payment.connected_account
         SET charges_enabled = ${account.chargesEnabled}, payouts_enabled = ${account.payoutsEnabled},
             details_submitted = ${account.detailsSubmitted}, bank_last4 = ${account.bankLast4},
             updated_at = now()
       WHERE account_ref = ${account.accountRef}
      RETURNING *`);
    return rows[0] === undefined ? null : toRow(rows[0]);
  }
}

function toRow(row: Record<string, unknown>): ConnectedAccountRow {
  return {
    owner: {
      kind: row["owner_kind"] as PayoutOwner["kind"],
      id: String(row["owner_id"]),
      region: "AU",
    },
    provider: row["provider"] as PayoutProvider,
    accountRef: String(row["account_ref"]),
    chargesEnabled: row["charges_enabled"] === true,
    payoutsEnabled: row["payouts_enabled"] === true,
    detailsSubmitted: row["details_submitted"] === true,
    bankLast4: typeof row["bank_last4"] === "string" ? row["bank_last4"] : null,
  };
}
