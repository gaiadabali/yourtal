import type { PublicListing } from "@yourtal/contracts/listing";
import { filterListingsByCategory } from "./store-category";
import { filterListingsByChannel } from "./store-channel";
import { filterListingsByPriceBand } from "./store-price-band";
import { filterListingsByLocation, filterListingsByMerchant } from "./store-facets";
import type { StoreBoardParams } from "./store-board-params";

/**
 * Applies all five Store browse filters (11.6.a: "category, channel and
 * price", plus location and merchant carried over from YT-0420) in one
 * call. Each predicate is independently tested in its own module; this is
 * only composition, so it stays untested itself per
 * docs/13b-typescript-standards.md §9's "a component with no logic gets no
 * test" — there is no branching here to exercise beyond what each filter
 * already covers.
 */
export function filterListings(
  listings: readonly PublicListing[],
  params: StoreBoardParams,
): PublicListing[] {
  const byCategory = filterListingsByCategory(listings, params.category);
  const byChannel = filterListingsByChannel(byCategory, params.channel);
  const byPriceBand = filterListingsByPriceBand(byChannel, params.priceBand);
  const byLocation = filterListingsByLocation(byPriceBand, params.location);
  return filterListingsByMerchant(byLocation, params.merchant);
}
