import type { Listing } from "@yourtal/contracts/listing";
import { filterListingsByCategory } from "./store-category";
import { filterListingsByPriceBand } from "./store-price-band";
import { filterListingsByLocation, filterListingsByMerchant } from "./store-facets";
import type { StoreBoardParams } from "./store-board-params";

/**
 * Applies all four Store browse filters (YT-0420 acceptance: "category,
 * merchant, price-band and location filters") in one call. Each predicate
 * is independently tested in its own module; this is only composition, so
 * it stays untested itself per docs/13b-typescript-standards.md §9's "a
 * component with no logic gets no test" — there is no branching here to
 * exercise beyond what each filter already covers.
 */
export function filterListings(listings: readonly Listing[], params: StoreBoardParams): Listing[] {
  const byCategory = filterListingsByCategory(listings, params.category);
  const byPriceBand = filterListingsByPriceBand(byCategory, params.priceBand);
  const byLocation = filterListingsByLocation(byPriceBand, params.location);
  return filterListingsByMerchant(byLocation, params.merchant);
}
