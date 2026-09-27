import { errAsync, ResultAsync } from "neverthrow";
import type { MerchantLocation } from "@yourtal/contracts/listing/merchant-location";
import type { EditLocationError } from "../store.errors";
import type { EditLocationInput, LocationRepository } from "../persistence/location.repository";
import { wrapPersistence } from "../wrap-persistence";

export function editLocation(
  locations: LocationRepository,
  merchantId: string,
  locationId: string,
  patch: EditLocationInput,
): ResultAsync<MerchantLocation, EditLocationError> {
  return wrapPersistence(locations.updateFields(merchantId, locationId, patch)).andThen(
    (location) => {
      if (location === null) {
        return errAsync<MerchantLocation, EditLocationError>({
          type: "location_not_found",
          locationId,
        });
      }
      return ResultAsync.fromSafePromise(Promise.resolve(location));
    },
  );
}
