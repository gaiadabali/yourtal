import { errAsync, ResultAsync } from "neverthrow";
import type { Listing } from "@yourtal/contracts/listing";
import type { GetListingError } from "../store.errors";
import type { ListingRepository } from "../persistence/listing.repository";
import { wrapPersistence } from "../wrap-persistence";

/** One of a merchant's own listings, any lifecycle state. 404s outside the tenant. */
export function getMyListing(
  listings: ListingRepository,
  merchantId: string,
  listingId: string,
): ResultAsync<Listing, GetListingError> {
  return wrapPersistence(listings.findOwnedById(merchantId, listingId)).andThen((listing) => {
    if (listing === null) {
      return errAsync<Listing, GetListingError>({ type: "listing_not_found", listingId });
    }
    return ResultAsync.fromSafePromise(Promise.resolve(listing));
  });
}
