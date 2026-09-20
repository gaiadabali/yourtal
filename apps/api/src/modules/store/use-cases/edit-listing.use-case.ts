import { errAsync, ResultAsync } from "neverthrow";
import type { Listing } from "@yourtal/contracts/listing";
import type { EditListingError } from "../store.errors";
import type { EditListingInput, ListingRepository } from "../persistence/listing.repository";
import { wrapPersistence } from "../wrap-persistence";

/** Non-price, non-lifecycle fields only — see `edit-listing.schema.ts`. */
export function editListing(
  listings: ListingRepository,
  merchantId: string,
  listingId: string,
  patch: EditListingInput,
): ResultAsync<Listing, EditListingError> {
  return wrapPersistence(listings.updateFields(merchantId, listingId, patch)).andThen((updated) => {
    if (updated === null) {
      return errAsync<Listing, EditListingError>({ type: "listing_not_found", listingId });
    }
    return ResultAsync.fromSafePromise(Promise.resolve(updated));
  });
}
