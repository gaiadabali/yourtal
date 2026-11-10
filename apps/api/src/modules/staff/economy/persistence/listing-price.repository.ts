import type { Pool, PoolClient } from "pg";
import type { Region } from "@yourtal/contracts/region";

export const LISTING_PRICE_REPOSITORY = Symbol("LISTING_PRICE_REPOSITORY");

/** What the price screen needs of one `store.listings` row. */
export interface ListingPriceFacts {
  readonly id: string;
  readonly title: string;
  readonly merchantName: string;
  readonly region: Region;
  readonly currency: "AUD" | "IDR";
  readonly faceValueMinor: number;
  readonly settlementMinor: number;
  readonly lifecycleState: string;
  readonly redeemPartnerId: string | null;
  readonly minPricePoints: number | null;
}

/**
 * 2.8.g: reads and the one write behind the staff listing price screen.
 * The write runs only inside the approval's transaction (`approveWith`).
 */
export interface ListingPriceRepository {
  /**
   * With no query: every listing in the region with a staff price, a partner
   * binding or an open price proposal. With one: up to 25 listings whose
   * title or merchant matches, or whose id is the query.
   */
  search(region: Region, query: string | null): Promise<readonly ListingPriceFacts[]>;
  find(listingId: string): Promise<ListingPriceFacts | null>;
  /** Sets or clears the price; false when the listing is not in this region. */
  apply(
    client: PoolClient,
    listingId: string,
    region: Region,
    minPricePoints: number | null,
  ): Promise<boolean>;
}

interface Row {
  id: string;
  title: string;
  merchant_name: string;
  region: Region;
  currency: "AUD" | "IDR";
  face_value_minor: string | number;
  settlement_value_minor: string | number;
  lifecycle_state: string;
  redeem_partner_id: string | null;
  min_price_points: string | number | null;
}

const COLUMNS = `id::text, title, merchant_name, region, currency, face_value_minor,
  settlement_value_minor, lifecycle_state, redeem_partner_id, min_price_points`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toFacts(row: Row): ListingPriceFacts {
  return {
    id: row.id,
    title: row.title,
    merchantName: row.merchant_name,
    region: row.region,
    currency: row.currency,
    faceValueMinor: Number(row.face_value_minor),
    settlementMinor: Number(row.settlement_value_minor),
    lifecycleState: row.lifecycle_state,
    redeemPartnerId: row.redeem_partner_id,
    minPricePoints: row.min_price_points === null ? null : Number(row.min_price_points),
  };
}

export class PostgresListingPriceRepository implements ListingPriceRepository {
  constructor(private readonly pool: Pool) {}

  async search(region: Region, query: string | null): Promise<readonly ListingPriceFacts[]> {
    if (query === null) {
      const result = await this.pool.query<Row>(
        `SELECT ${COLUMNS} FROM store.listings l
          WHERE l.region = $1
            AND (l.min_price_points IS NOT NULL OR l.redeem_partner_id IS NOT NULL
                 OR EXISTS (SELECT 1 FROM staff.economy_proposal p
                             WHERE p.kind = 'listing_price' AND p.status = 'pending'
                               AND p.payload->>'listingId' = l.id::text))
          ORDER BY l.title, l.id
          LIMIT 100`,
        [region],
      );
      return result.rows.map(toFacts);
    }
    const byId = UUID.test(query) ? query : null;
    const like = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const result = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM store.listings
        WHERE region = $1
          AND (id::text = $2 OR title ILIKE $3 OR merchant_name ILIKE $3)
        ORDER BY title, id
        LIMIT 25`,
      [region, byId, like],
    );
    return result.rows.map(toFacts);
  }

  async find(listingId: string): Promise<ListingPriceFacts | null> {
    if (!UUID.test(listingId)) return null;
    const result = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM store.listings WHERE id = $1`,
      [listingId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toFacts(row);
  }

  async apply(
    client: PoolClient,
    listingId: string,
    region: Region,
    minPricePoints: number | null,
  ): Promise<boolean> {
    const result = await client.query(
      `UPDATE store.listings SET min_price_points = $3 WHERE id = $1 AND region = $2`,
      [listingId, region, minPricePoints],
    );
    return result.rowCount === 1;
  }
}
