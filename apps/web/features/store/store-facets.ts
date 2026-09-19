import type { Listing } from "@yourtal/contracts/listing";

/**
 * Merchant and location filters for the Store browse grid (YT-0420).
 * Unlike category and price-band, these two are not fixed enums in the
 * contract — `district` is a free-form string and merchants are catalogue
 * data — so their filter options are derived from whatever listings are
 * actually on the shelf, not a hand-maintained list that can drift from it.
 * The two facets share the same shape (dedupe a field, sort for a
 * `<select>`, filter by exact match against an "all" sentinel), so they are
 * kept in one small file rather than two near-identical ones.
 *
 * YT-0405: `listingLocations`/`listingMerchants` sort with `localeCompare`,
 * which is collation, not copy — it takes an optional `locale`, defaulting
 * to `id-ID` so existing callers keep today's ordering.
 */
export const STORE_LOCATION_ALL = "all";
export const STORE_MERCHANT_ALL = "all";

type SupportedLocale = "en-AU" | "id-ID";

export interface StoreMerchantOption {
  id: string;
  name: string;
}

/** Every district represented in `listings`, alphabetised for a `<select>`. */
export function listingLocations(
  listings: readonly Listing[],
  locale: SupportedLocale = "id-ID",
): string[] {
  return Array.from(new Set(listings.map((listing) => listing.district))).sort((a, b) =>
    a.localeCompare(b, locale),
  );
}

/** Every merchant represented in `listings`, deduplicated by id and alphabetised by name. */
export function listingMerchants(
  listings: readonly Listing[],
  locale: SupportedLocale = "id-ID",
): StoreMerchantOption[] {
  const byId = new Map<string, string>();
  for (const listing of listings) {
    byId.set(listing.merchantId, listing.merchantName);
  }
  return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) =>
    a.name.localeCompare(b.name, locale),
  );
}

export function filterListingsByLocation(
  listings: readonly Listing[],
  district: string,
): Listing[] {
  if (district === STORE_LOCATION_ALL) {
    return [...listings];
  }
  return listings.filter((listing) => listing.district === district);
}

export function filterListingsByMerchant(
  listings: readonly Listing[],
  merchantId: string,
): Listing[] {
  if (merchantId === STORE_MERCHANT_ALL) {
    return [...listings];
  }
  return listings.filter((listing) => listing.merchantId === merchantId);
}
