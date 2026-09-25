import { sql } from "drizzle-orm";
import type { Audience } from "@yourtal/contracts/audience/audience";
import type { Region } from "@yourtal/contracts/region";
import { toMinorUnits, type MinorUnits } from "@yourtal/contracts/money";
import type { AppDb } from "../../../shared/persistence/drizzle-client";

/** What checkout needs to know about a listing. C's `store.listings`, read only. */
export interface ListingForCheckout {
  readonly id: string;
  readonly region: Region;
  readonly currency: string;
  readonly settlementMinor: MinorUnits;
  readonly audience: Audience;
  readonly channel: string;
  readonly buyable: boolean;
}

interface Row extends Record<string, unknown> {
  id: string;
  region: Region;
  currency: string;
  settlement_value_minor: string | number;
  audience: Audience;
  channel: string;
  buyable: boolean;
}

export async function findListingForCheckout(
  db: AppDb,
  listingId: string,
): Promise<ListingForCheckout | null> {
  const result = await db.execute<Row>(sql`
    SELECT id::text, region, currency, settlement_value_minor, audience, channel,
           (lifecycle_state = 'active' AND stock_remaining > 0 AND expires_at > now()) AS buyable
      FROM store.listings WHERE id = ${listingId}::uuid
  `);
  const row = result.rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    region: row.region,
    currency: row.currency,
    settlementMinor: toMinorUnits(Number(row.settlement_value_minor)),
    audience: row.audience,
    channel: row.channel,
    buyable: row.buyable,
  };
}
