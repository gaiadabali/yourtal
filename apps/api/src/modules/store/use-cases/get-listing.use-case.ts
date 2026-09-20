import { errAsync, ResultAsync } from "neverthrow";
import type { Listing } from "@yourtal/contracts/listing";
import type { GetListingError } from "../store.errors";
import type { ListingRepository } from "../persistence/listing.repository";
import { wrapPersistence } from "../wrap-persistence";

/** The offer detail page (`apps/web/features/burn`). `active` only — see the repository. */
export function getListing(
  listings: ListingRepository,
  listingId: string,
): ResultAsync<Listing, GetListingError> {
  return wrapPersistence(listings.findPublicById(listingId)).andThen((listing) => {
    if (listing === null) {
      return errAsync<Listing, GetListingError>({ type: "listing_not_found", listingId });
    }
    return ResultAsync.fromSafePromise(Promise.resolve(listing));
  });
}
