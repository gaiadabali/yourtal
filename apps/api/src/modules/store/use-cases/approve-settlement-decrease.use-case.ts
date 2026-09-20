import { errAsync, ResultAsync } from "neverthrow";
import type { ApproveSettlementDecreaseError } from "../store.errors";
import type { ListingRepository, SettlementValueChange } from "../persistence/listing.repository";
import type { SettlementDecreaseRequestRepository } from "../persistence/settlement-decrease-request.repository";
import { wrapPersistence } from "../wrap-persistence";

/**
 * Approves a pending settlement-decrease request, applying its value change
 * in the same transaction as claiming it (YT-0575).
 *
 * The self-approval refusal is NOT here — it is the WHERE clause inside
 * `SettlementDecreaseRequestRepository.approve` (`requested_by <>
 * $approverId`), so a self-approval matches no row rather than being caught
 * by a check a use-case remembered to run first (docs/13c: "a WHERE clause
 * protects the data"). This use-case only proves the listing belongs to
 * this tenant before delegating — the same shape `getMyListing` gives every
 * other listing use-case — and translates a refused claim into the one
 * collapsed `approval_refused` error.
 */
export function approveSettlementDecrease(
  listings: ListingRepository,
  requests: SettlementDecreaseRequestRepository,
  merchantId: string,
  listingId: string,
  requestId: string,
  approverId: string,
): ResultAsync<SettlementValueChange, ApproveSettlementDecreaseError> {
  return wrapPersistence(listings.findOwnedById(merchantId, listingId)).andThen((listing) => {
    if (listing === null) {
      return errAsync<SettlementValueChange, ApproveSettlementDecreaseError>({
        type: "listing_not_found",
        listingId,
      });
    }
    return wrapPersistence(requests.approve(merchantId, listingId, requestId, approverId)).andThen(
      (change) => {
        if (change === null) {
          return errAsync<SettlementValueChange, ApproveSettlementDecreaseError>({
            type: "approval_refused",
            requestId,
          });
        }
        return ResultAsync.fromSafePromise(Promise.resolve(change));
      },
    );
  });
}
