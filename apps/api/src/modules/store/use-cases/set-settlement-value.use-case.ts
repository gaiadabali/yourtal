import { errAsync, ResultAsync } from "neverthrow";
import type { SetSettlementValueError } from "../store.errors";
import type { ListingRepository, SettlementValueChange } from "../persistence/listing.repository";
import { wrapPersistence } from "../wrap-persistence";

/**
 * Reprices a listing's settlement value `S` (docs/17 section 2.1). The
 * points price is deliberately NOT recomputed here — `yourtal_app` has no
 * grant on the `ledger` schema at all (`REVOKE ALL ON SCHEMA ledger FROM
 * yourtal_app`, infra/postgres/init/01-schemas.sql), and `points_price = S /
 * B` needs the ledger's backing rate `B`. `store.listings.price_in_points`
 * is left exactly as it was; `store.listing_price_revision` records that a
 * reprice happened and is awaiting the ledger's pricing engine to close it —
 * see this module's migration for the seam this leaves for that work.
 */
export function setSettlementValue(
  listings: ListingRepository,
  merchantId: string,
  listingId: string,
  newSettlementValueIdr: number,
  requestedBy: string,
  reason: string,
): ResultAsync<SettlementValueChange, SetSettlementValueError> {
  return wrapPersistence(
    listings.updateSettlementValue(
      merchantId,
      listingId,
      newSettlementValueIdr,
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
