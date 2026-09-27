import { errAsync, ResultAsync } from "neverthrow";
import type { SetSettlementValueError } from "../store.errors";
import type { ListingRepository, SettlementValueChange } from "../persistence/listing.repository";
import { wrapPricedPersistence } from "../wrap-persistence";

/**
 * Reprices a listing's settlement value `S` (docs/17 section 2.1). Since
 * 7.4.b, `store.listings.price_in_points` and `store.listing_price_revision`
 * are both updated with the ledger's real answer -- see
 * `apply-settlement-value-change.ts`, which `updateSettlementValue` calls.
 */
export function setSettlementValue(
  listings: ListingRepository,
  merchantId: string,
  listingId: string,
  newSettlementValueMinor: number,
  requestedBy: string,
  reason: string,
): ResultAsync<SettlementValueChange, SetSettlementValueError> {
  return wrapPricedPersistence(
    listings.updateSettlementValue(
      merchantId,
      listingId,
      newSettlementValueMinor,
      requestedBy,
      reason,
    ),
  ).andThen((change) => {
    if (change === null) {
      return errAsync<SettlementValueChange, SetSettlementValueError>({
        type: "listing_not_found",
        listingId,
      });
    }
    return ResultAsync.fromSafePromise(Promise.resolve(change));
  });
}
