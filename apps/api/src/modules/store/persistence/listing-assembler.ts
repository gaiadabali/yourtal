import { eq } from "drizzle-orm";
import type { Listing, PublicListing } from "@yourtal/contracts/listing";
import { listingSchema, publicListingSchema } from "@yourtal/contracts/listing";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import type { listings } from "./schema/listing.table";
import { listingLocations, merchantLocations } from "./schema/listing.table";

export type ListingRow = typeof listings.$inferSelect;

export class MalformedListingRowError extends Error {
  constructor(readonly listingId: string | undefined) {
    super(`store.listings row ${String(listingId)} does not match listingSchema`);
    this.name = "MalformedListingRowError";
  }
}

/**
 * Builds and parses the CUSTOMER-facing `Listing` from a `store.listings`
 * row plus its joined locations — the one place `lifecycle_state` and other
 * merchant-only columns get left behind, following the split
 * `DrizzleCampaignRepository.assemble` (YT-0553) makes for `lifecycle_state`
 * vs `campaignSchema.status`.
 *
 * Takes the db/tx explicitly so a caller can run it inside the same
 * transaction as a write (`create`, `updateSettlementValue`) instead of
 * racing a second connection against uncommitted rows.
 */
export async function assembleListing(
  db: Pick<AppDb, "select">,
  row: ListingRow,
): Promise<Listing | null> {
  const locationRows = await db
    .select({
      id: merchantLocations.id,
      name: merchantLocations.name,
      address: merchantLocations.address,
      district: merchantLocations.district,
    })
    .from(listingLocations)
    .innerJoin(merchantLocations, eq(merchantLocations.id, listingLocations.locationId))
    .where(eq(listingLocations.listingId, row.id));

  const parsed = listingSchema.safeParse({
    id: row.id,
    merchantId: row.merchantId,
    merchantName: row.merchantName,
    title: row.title,
    description: row.description,
    category: row.category,
    locations: locationRows,
    currency: row.currency,
    faceValueMinor: row.faceValueMinor,
    settlementValueMinor: row.settlementValueMinor,
    priceInPoints: row.priceInPoints,
    stockRemaining: row.stockRemaining,
    stockTotal: row.stockTotal,
    transferable: row.transferable,
    partialRedemptionPolicy: row.partialRedemptionPolicy,
    minimumSpendMinor: row.minimumSpendMinor,
    expiresAt: row.expiresAt.toISOString(),
    status: row.status,
    perUserLimit: row.perUserLimit ?? undefined,
  });
  return parsed.success ? parsed.data : null;
}

/**
 * `assembleListing` over every row. A row that fails to parse THROWS: dropping
 * it silently is how every price rendered NaN with nothing logged. A bad row
 * is a bug to surface, not a listing to hide.
 */
export async function assembleListings(
  db: Pick<AppDb, "select">,
  rows: readonly ListingRow[],
): Promise<Listing[]> {
  const assembled = await Promise.all(rows.map((row) => assembleListing(db, row)));
  return assembled.map((listing, i) => {
    if (listing === null) throw new MalformedListingRowError(rows[i]?.id);
    return listing;
  });
}

/**
 * The PUBLIC-catalogue counterparts. Separate functions rather than a flag,
 * because a boolean argument is a thing a caller can get wrong at a route
 * that must never be wrong: `browsePublic` and `findPublicById` can only
 * reach `publicListingSchema`, which has no `settlementValueMinor` field to
 * populate.
 *
 * Parsed through the public schema rather than assembled and then deleted
 * from -- a delete leaves the value in memory on the path to the response
 * and depends on every future field being remembered. See
 * `publicListingSchema`'s own comment for why S in particular (docs/24
 * ID-1: publishing S beside priceInPoints publishes the backing rate B by
 * arithmetic).
 */
export async function assemblePublicListing(
  db: Pick<AppDb, "select">,
  row: ListingRow,
): Promise<PublicListing | null> {
  const listing = await assembleListing(db, row);
  if (listing === null) return null;
  const { settlementValueMinor: _withheld, ...rest } = listing;
  const parsed = publicListingSchema.safeParse(rest);
  return parsed.success ? parsed.data : null;
}

/** `assemblePublicListing` over every row; throws on one that fails to parse. */
export async function assemblePublicListings(
  db: Pick<AppDb, "select">,
  rows: readonly ListingRow[],
): Promise<PublicListing[]> {
  const assembled = await Promise.all(rows.map((row) => assemblePublicListing(db, row)));
  return assembled.map((listing, i) => {
    if (listing === null) throw new MalformedListingRowError(rows[i]?.id);
    return listing;
  });
}
