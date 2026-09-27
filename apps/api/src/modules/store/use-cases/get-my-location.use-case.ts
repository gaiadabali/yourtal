import { errAsync, ResultAsync } from "neverthrow";
import type { MerchantLocation } from "@yourtal/contracts/listing/merchant-location";
import type { EditLocationError } from "../store.errors";
import type { LocationRepository } from "../persistence/location.repository";
import { wrapPersistence } from "../wrap-persistence";

/** Shares `EditLocationError`'s shape (`location_not_found`) -- a plain read has the same failure mode. */
export function getMyLocation(
  locations: LocationRepository,
  merchantId: string,
  locationId: string,
): ResultAsync<MerchantLocation, EditLocationError> {
  return wrapPersistence(locations.findOwnedById(merchantId, locationId)).andThen((location) => {
    if (location === null) {
      return errAsync<MerchantLocation, EditLocationError>({
        type: "location_not_found",
        locationId,
      });
    }
    return ResultAsync.fromSafePromise(Promise.resolve(location));
  });
}
