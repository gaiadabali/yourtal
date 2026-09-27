import type { ResultAsync } from "neverthrow";
import type { MerchantLocation } from "@yourtal/contracts/listing/merchant-location";
import type { CreateLocationError } from "../store.errors";
import type { CreateLocationInput, LocationRepository } from "../persistence/location.repository";
import { wrapPersistence } from "../wrap-persistence";

/** 7.4.a: a business's own branch. No business-existence check here -- `:tenantId` is already PDP-checked. */
export function createLocation(
  locations: LocationRepository,
  merchantId: string,
  input: CreateLocationInput,
): ResultAsync<MerchantLocation, CreateLocationError> {
  return wrapPersistence(locations.create(merchantId, input));
}
