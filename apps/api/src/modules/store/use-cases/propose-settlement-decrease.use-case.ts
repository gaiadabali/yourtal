import { errAsync } from "neverthrow";
import type { ResultAsync } from "neverthrow";
import type { ProposeSettlementDecreaseError } from "../store.errors";
import { isMaterialSettlementDecrease } from "../material-settlement-decrease";
import type { ListingRepository } from "../persistence/listing.repository";
import type {
  SettlementDecreaseRequest,
  SettlementDecreaseRequestRepository,
} from "../persistence/settlement-decrease-request.repository";
import { wrapPersistence } from "../wrap-persistence";

/**
 * Records a proposed material settlement-value decrease as PENDING. Applies
 * nothing (YT-0575) — a second person's `approveSettlementDecrease` is what
 * writes `store.listings.settlement_value_idr`.
 *
 * Rejects a change that is not a decrease, or not a MATERIAL one, so this
 * table only ever holds what `policies/resource_policies/listing.yaml`
 * actually routes here — an ordinary edit still goes through
 * `set_settlement_value` directly. Rejects a second proposal while one is
 * already pending; the migration's partial unique index is the real
 * enforcement of that (a race can still reach it), this is the readable
 * error for the common case.
 */
export function proposeSettlementDecrease(
  listings: ListingRepository,
  requests: SettlementDecreaseRequestRepository,
  merchantId: string,
  listingId: string,
  proposedSettlementValueIdr: number,
  requestedBy: string,
  reason: string,
): ResultAsync<SettlementDecreaseRequest, ProposeSettlementDecreaseError> {
  return wrapPersistence(listings.findOwnedById(merchantId, listingId)).andThen((listing) => {
    if (listing === null) {
      return errAsync<SettlementDecreaseRequest, ProposeSettlementDecreaseError>({
        type: "listing_not_found",
        listingId,
      });
    }
    if (!isMaterialSettlementDecrease(listing.settlementValueIdr, proposedSettlementValueIdr)) {
      return errAsync<SettlementDecreaseRequest, ProposeSettlementDecreaseError>({
        type: "not_a_material_decrease",
        listingId,
      });
    }
    return wrapPersistence(requests.findPendingForListing(listingId)).andThen((pending) => {
      if (pending !== null) {
        return errAsync<SettlementDecreaseRequest, ProposeSettlementDecreaseError>({
          type: "decrease_already_pending",
          listingId,
        });
      }
      return wrapPersistence(
        requests.create({
          listingId,
          requestedBy,
          currentSettlementValueIdr: listing.settlementValueIdr,
          proposedSettlementValueIdr,
          reason,
        }),
      );
    });
  });
}
