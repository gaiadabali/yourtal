import { errAsync, ResultAsync } from "neverthrow";
import type { Listing } from "@yourtal/contracts/listing";
import type { SetListingLifecycleError } from "../store.errors";
import type { ListingLifecycleState, ListingRepository } from "../persistence/listing.repository";
import { wrapPersistence } from "../wrap-persistence";

/**
 * The legal moves for `store.listings.lifecycle_state`. `retired` is
 * terminal — once retired, a listing offers no way back, matching the
 * "sub-resource action" shape docs/13 section 5 asks for
 * (`POST /listings/{id}/retire`) rather than a general PATCH that could
 * quietly resurrect one.
 */
const LEGAL_TRANSITIONS: Record<ListingLifecycleState, readonly ListingLifecycleState[]> = {
  active: ["paused", "retired"],
  paused: ["active", "retired"],
  retired: [],
};

export function setListingLifecycle(
  listings: ListingRepository,
  merchantId: string,
  listingId: string,
  next: ListingLifecycleState,
): ResultAsync<Listing, SetListingLifecycleError> {
  return wrapPersistence(listings.lifecycleStateOf(merchantId, listingId)).andThen((current) => {
    if (current === null) {
      return errAsync<Listing, SetListingLifecycleError>({
        type: "listing_not_found",
        listingId,
      });
    }
    if (!LEGAL_TRANSITIONS[current].includes(next)) {
      return errAsync<Listing, SetListingLifecycleError>({
        type: "invalid_lifecycle_transition",
        from: current,
        to: next,
      });
    }
    return wrapPersistence(listings.setLifecycleState(merchantId, listingId, next)).andThen(
      (updated) => {
        if (updated === null) {
          return errAsync<Listing, SetListingLifecycleError>({
            type: "listing_not_found",
            listingId,
          });
        }
        return ResultAsync.fromSafePromise(Promise.resolve(updated));
      },
    );
  });
}
