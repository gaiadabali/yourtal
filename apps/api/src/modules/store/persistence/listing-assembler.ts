import { storedTagsOf } from "@yourtal/contracts/interest/tags";
import { eq } from "drizzle-orm";
import type { Listing, PublicListing } from "@yourtal/contracts/listing";
import { listingSchema, publicListingSchema } from "@yourtal/contracts/listing";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { pricePointsByListing, unallocatedStockByListing } from "./listing-live-values";
import type { listings } from "./schema/listing.table";
import { listingLocations, merchantLocations } from "./schema/listing.table";

export type ListingRow = typeof listings.$inferSelect;

/** The subset of `AppDb` assembly needs — satisfied by both a live handle and a transaction. */
type Db = Pick<AppDb, "select" | "execute">;

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
 * `priceInPoints` and `stockRemaining` are OVERRIDDEN with live values
 * (7.4.b, 7.4.c) rather than trusted from the row -- see
 * `listing-live-values.ts`. `priceOverride`/`stockOverride` let a caller
 * that already fetched them for a whole page (`assembleListings`,
 * `assemblePublicListings`) skip the extra per-row query; a single-row
 * caller (`findOwnedById`, `create`, `updateSettlementValue`) omits them and
 * this function fetches its own.
 *
 * Takes the db/tx explicitly so a caller can run it inside the same
 * transaction as a write (`create`, `updateSettlementValue`) instead of
 * racing a second connection against uncommitted rows.
 */
export async function assembleListing(
  db: Db,
  row: ListingRow,
  priceOverride?: number,
  stockOverride?: number,
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

  const priceInPoints =
    priceOverride ?? (await pricePointsByListing(db, [row.id])).get(row.id) ?? row.priceInPoints;
  const stockRemaining =
    stockOverride ?? (await unallocatedStockByListing(db, [row.id])).get(row.id) ?? 0;

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
    priceInPoints,
    stockRemaining,
    stockTotal: row.stockTotal,
    transferable: row.transferable,
    partialRedemptionPolicy: row.partialRedemptionPolicy,
    minimumSpendMinor: row.minimumSpendMinor,
    expiresAt: row.expiresAt.toISOString(),
    status: row.status,
    perUserLimit: row.perUserLimit ?? undefined,
    region: row.region,
    audience: row.audience,
    contentCategory: row.contentCategory,
    tags: storedTagsOf(row.tags),
    imageUrl: row.imageUrl,
    channel: row.channel,
    partialRedemption: row.partialRedemption,
  });
  if (!parsed.success) {
    // A bad row is a bug to surface (see assembleListings' own comment) --
    // logged here, at the one place the actual Zod issues are still in
    // scope, since MalformedListingRowError's own message cannot carry them
    // without every call site threading a reason through.
    console.error(
      `store.listings row ${row.id} failed listingSchema:`,
      JSON.stringify(parsed.error.issues),
    );
  }
  return parsed.success ? parsed.data : null;
}

/**
 * `assembleListing` over every row, with the price/stock lookups batched
 * ONE query each for the whole page rather than one per row. A row that
 * fails to parse THROWS: dropping it silently is how every price rendered
 * NaN with nothing logged. A bad row is a bug to surface, not a listing to
 * hide.
 */
export async function assembleListings(db: Db, rows: readonly ListingRow[]): Promise<Listing[]> {
  const ids = rows.map((row) => row.id);
  const [prices, stock] = await Promise.all([
    pricePointsByListing(db, ids),
    unallocatedStockByListing(db, ids),
  ]);
  const assembled = await Promise.all(
    rows.map((row) => assembleListing(db, row, prices.get(row.id), stock.get(row.id) ?? 0)),
  );
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
  db: Db,
  row: ListingRow,
  priceOverride?: number,
  stockOverride?: number,
): Promise<PublicListing | null> {
  const listing = await assembleListing(db, row, priceOverride, stockOverride);
  if (listing === null) return null;
  const { settlementValueMinor: _withheld, ...rest } = listing;
  const parsed = publicListingSchema.safeParse(rest);
  return parsed.success ? parsed.data : null;
}

/** `assemblePublicListing` over every row, batched the same way `assembleListings` is; throws on a bad row. */
export async function assemblePublicListings(
  db: Db,
  rows: readonly ListingRow[],
): Promise<PublicListing[]> {
  const ids = rows.map((row) => row.id);
  const [prices, stock] = await Promise.all([
    pricePointsByListing(db, ids),
    unallocatedStockByListing(db, ids),
  ]);
  const assembled = await Promise.all(
    rows.map((row) => assemblePublicListing(db, row, prices.get(row.id), stock.get(row.id) ?? 0)),
  );
  return assembled.map((listing, i) => {
    if (listing === null) throw new MalformedListingRowError(rows[i]?.id);
    return listing;
  });
}
