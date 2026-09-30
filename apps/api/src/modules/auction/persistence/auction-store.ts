import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { Region } from "@yourtal/contracts/region";
import type { AppDb } from "../../../shared/persistence/drizzle-client";

/** Anything that can run a statement: the pool or an open transaction. */
export type Executor = Pick<AppDb, "execute">;

export interface CharityForAuction {
  readonly id: string;
  readonly name: string;
  readonly cause: string;
  readonly logoUrl: string | null;
  /** The provider-held account a winning capture settles into. */
  readonly payoutReference: string;
  /** Who administers it: where an unsold voucher goes. */
  readonly adminUserId: string | null;
}

export interface AuctionRow {
  readonly id: string;
  readonly region: Region;
  readonly currency: "AUD" | "IDR";
  readonly sellerId: string;
  readonly charityId: string;
  readonly charityName: string;
  readonly charityCause: string;
  readonly charityLogoUrl: string | null;
  readonly title: string;
  readonly merchantName: string;
  readonly category: string;
  readonly faceValueMinor: number;
  readonly voucherExpiresAt: Date;
  readonly reserveMinor: number;
  readonly currentAmountMinor: number | null;
  readonly bidCount: number;
  readonly leaderBidderId: string | null;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly extensions: number;
  readonly state: "open" | "settled" | "cancelled";
  readonly outcome: "sold" | "unsold" | "cancelled" | null;
  readonly winnerId: string | null;
}

export interface BidRow {
  readonly id: string;
  readonly bidderId: string;
  readonly amountMinor: number;
  readonly holdReference: string;
  readonly state: string;
}

type RawAuction = Record<string, unknown>;

const AUCTION_SELECT = sql`
  SELECT a.id, a.region, a.currency, a.seller_id, a.charity_id, c.name AS charity_name,
         c.cause AS charity_cause, c.logo_url AS charity_logo_url, a.title, a.merchant_name,
         a.category, a.face_value_minor, a.voucher_expires_at, a.reserve_minor,
         a.current_amount_minor, a.bid_count, lb.bidder_id AS leader_bidder_id, a.starts_at,
         a.ends_at, a.extensions, a.state, a.outcome, s.winner_id
    FROM auction.auction a
    JOIN charity.charity c ON c.id = a.charity_id
    LEFT JOIN auction.bid lb ON lb.id = a.leader_bid_id
    LEFT JOIN auction.settlement s ON s.auction_id = a.id
`;

const num = (value: unknown): number => Number(value);
const orNull = <T>(value: unknown, map: (v: unknown) => T): T | null =>
  value === null || value === undefined ? null : map(value);

function toAuction(row: RawAuction): AuctionRow {
  return {
    id: String(row["id"]),
    region: row["region"] as Region,
    currency: row["currency"] as "AUD" | "IDR",
    sellerId: String(row["seller_id"]),
    charityId: String(row["charity_id"]),
    charityName: String(row["charity_name"]),
    charityCause: String(row["charity_cause"]),
    charityLogoUrl: orNull(row["charity_logo_url"], String),
    title: String(row["title"]),
    merchantName: String(row["merchant_name"]),
    category: String(row["category"]),
    faceValueMinor: num(row["face_value_minor"]),
    voucherExpiresAt: new Date(String(row["voucher_expires_at"])),
    reserveMinor: num(row["reserve_minor"]),
    currentAmountMinor: orNull(row["current_amount_minor"], num),
    bidCount: num(row["bid_count"]),
    leaderBidderId: orNull(row["leader_bidder_id"], String),
    startsAt: new Date(String(row["starts_at"])),
    endsAt: new Date(String(row["ends_at"])),
    extensions: num(row["extensions"]),
    state: row["state"] as AuctionRow["state"],
    outcome: orNull(row["outcome"], (v) => v as NonNullable<AuctionRow["outcome"]>),
    winnerId: orNull(row["winner_id"], String),
  };
}

export class AuctionStore {
  constructor(readonly db: AppDb) {}

  async charity(charityId: string, region: Region): Promise<CharityForAuction | null> {
    const { rows } = await this.db.execute(sql`
      SELECT c.id, c.name, c.cause, c.logo_url, c.payout_reference,
             (SELECT m.user_id FROM charity.member m WHERE m.charity_id = c.id
               ORDER BY m.created_at LIMIT 1) AS admin_user_id
        FROM charity.charity c
       WHERE c.id = ${charityId} AND c.region = ${region} AND c.state = 'approved'
    `);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      id: String(row["id"]),
      name: String(row["name"]),
      cause: String(row["cause"]),
      logoUrl: orNull(row["logo_url"], String),
      payoutReference: String(row["payout_reference"]),
      adminUserId: orNull(row["admin_user_id"], String),
    };
  }

  async listingCategory(listingId: string): Promise<string> {
    const { rows } = await this.db.execute<{ category: string }>(
      sql`SELECT content_category AS category FROM store.listings WHERE id = ${listingId}`,
    );
    return rows[0]?.category ?? "other";
  }

  async insert(input: {
    readonly id: string;
    readonly region: Region;
    readonly currency: string;
    readonly sellerId: string;
    readonly charityId: string;
    readonly sourceVoucherId: string;
    readonly voucherId: string;
    readonly listingId: string;
    readonly title: string;
    readonly merchantName: string;
    readonly category: string;
    readonly faceValueMinor: number;
    readonly voucherExpiresAt: string;
    readonly reserveMinor: number;
    readonly endsAt: Date;
  }): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO auction.auction (id, region, currency, seller_id, charity_id, source_voucher_id,
        voucher_id, listing_id, title, merchant_name, category, face_value_minor,
        voucher_expires_at, reserve_minor, ends_at)
      VALUES (${input.id}, ${input.region}, ${input.currency}, ${input.sellerId}, ${input.charityId},
        ${input.sourceVoucherId}, ${input.voucherId}, ${input.listingId}, ${input.title},
        ${input.merchantName}, ${input.category}, ${input.faceValueMinor}, ${input.voucherExpiresAt},
        ${input.reserveMinor}, ${input.endsAt.toISOString()})
      ON CONFLICT (id) DO NOTHING
    `);
  }

  async get(db: Executor, auctionId: string): Promise<AuctionRow | null> {
    const { rows } = await db.execute<RawAuction>(sql`${AUCTION_SELECT} WHERE a.id = ${auctionId}`);
    return rows[0] === undefined ? null : toAuction(rows[0]);
  }

  async list(where: SQL, limit = 50): Promise<AuctionRow[]> {
    const { rows } = await this.db.execute<RawAuction>(
      sql`${AUCTION_SELECT} WHERE ${where} ORDER BY a.ends_at ASC LIMIT ${limit}`,
    );
    return rows.map(toAuction);
  }

  /** Locks the auction row: every bid and the close on one auction run one at a time. */
  async lock(tx: Executor, auctionId: string): Promise<void> {
    await tx.execute(sql`SELECT id FROM auction.auction WHERE id = ${auctionId} FOR UPDATE`);
  }

  async heldBids(tx: Executor, auctionId: string, bidderId?: string): Promise<BidRow[]> {
    const { rows } = await tx.execute(sql`
      SELECT id, bidder_id, amount_minor, hold_reference, state FROM auction.bid
       WHERE auction_id = ${auctionId} AND state = 'held'
         AND (${bidderId ?? null}::text IS NULL OR bidder_id = ${bidderId ?? null})
       ORDER BY amount_minor DESC, created_at ASC
    `);
    return rows.map((row) => ({
      id: String(row["id"]),
      bidderId: String(row["bidder_id"]),
      amountMinor: num(row["amount_minor"]),
      holdReference: String(row["hold_reference"]),
      state: String(row["state"]),
    }));
  }

  async highestBidBy(auctionId: string, bidderId: string): Promise<number | null> {
    const { rows } = await this.db.execute<{ top: string | null }>(sql`
      SELECT MAX(amount_minor) AS top FROM auction.bid
       WHERE auction_id = ${auctionId} AND bidder_id = ${bidderId}
    `);
    return orNull(rows[0]?.top, num);
  }

  async setBidState(tx: Executor, bidId: string, state: string): Promise<void> {
    await tx.execute(
      sql`UPDATE auction.bid SET state = ${state}, resolved_at = now() WHERE id = ${bidId}`,
    );
  }

  async dueIds(limit = 20): Promise<string[]> {
    const { rows } = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM auction.auction WHERE state = 'open' AND ends_at <= now()
       ORDER BY ends_at LIMIT ${limit}
    `);
    return rows.map((row) => row.id);
  }
}

export const AUCTION_STORE = Symbol("AUCTION_STORE");
