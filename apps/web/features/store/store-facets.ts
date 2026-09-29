import type { PublicListing } from "@yourtal/contracts/listing";
import { listingHasDistrict } from "./listing-locations";

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
 * `listingLocations`/`listingMerchants` sort with `localeCompare`, which is
 * collation, not copy — `locale` is still required and never defaulted
 * (6.1.c), so a caller that forgets it fails to compile rather than
 * silently sorting by the wrong region's collation rules.
 */
export const STORE_LOCATION_ALL = "all";
export const STORE_MERCHANT_ALL = "all";

type SupportedLocale = "en-AU" | "id-ID";

export interface StoreMerchantOption {
  id: string;
  name: string;
}

/**
 * Every district represented in `listings`, alphabetised for a `<select>`.
 * A listing with branches in three districts contributes all three, because
 * a filter that could not offer two of them would hide real inventory from
 * a user who is standing in one of those two districts.
 */
export function listingLocations(
  listings: readonly PublicListing[],
  locale: SupportedLocale,
): string[] {
  return Array.from(
    new Set(listings.flatMap((listing) => listing.locations.map((location) => location.district))),
  ).sort((a, b) => a.localeCompare(b, locale));
}

/** Every merchant represented in `listings`, deduplicated by id and alphabetised by name. */
export function listingMerchants(
  listings: readonly PublicListing[],
  locale: SupportedLocale,
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
  listings: readonly PublicListing[],
  district: string,
): PublicListing[] {
  if (district === STORE_LOCATION_ALL) {
    return [...listings];
  }
  return listings.filter((listing) => listingHasDistrict(listing, district));
}

export function filterListingsByMerchant(
  listings: readonly PublicListing[],
  merchantId: string,
): PublicListing[] {
  if (merchantId === STORE_MERCHANT_ALL) {
    return [...listings];
  }
  return listings.filter((listing) => listing.merchantId === merchantId);
}
