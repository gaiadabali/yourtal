import type { ResultAsync } from "neverthrow";
import { errAsync } from "neverthrow";
import type { Listing } from "@yourtal/contracts/listing";
import type { CreateListingError } from "../store.errors";
import type { CreateListingInput, ListingRepository } from "../persistence/listing.repository";
import { wrapPersistence } from "../wrap-persistence";

/**
 * Creates a listing, straight to `active` — there is no draft or
 * ops-approval step in this pass (see the module's migration header and the
 * ticket report on `approve_listing`/`reject_listing`).
 *
 * The location check runs BEFORE the insert rather than relying on a
 * database constraint, because there is no FK from `listing_location` back
 * to "this merchant" to violate — the constraint that exists
 * (`vouchers_location_is_offered_by_its_listing`) is about a voucher naming
 * one of ITS OWN listing's branches, not about a branch belonging to the
 * merchant creating the listing.
 */
export function createListing(
  listings: ListingRepository,
  merchantId: string,
  input: CreateListingInput,
): ResultAsync<Listing, CreateListingError> {
  return wrapPersistence(listings.locationsBelongToMerchant(merchantId, input.locationIds)).andThen(
    (valid) => {
      if (!valid) {
        return errAsync<Listing, CreateListingError>({
          type: "invalid_locations",
          locationIds: input.locationIds,
        });
      }
      return wrapPersistence(listings.create(merchantId, input));
    },
  );
}
