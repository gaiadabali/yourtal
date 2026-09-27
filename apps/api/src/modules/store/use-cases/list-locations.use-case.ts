import type { ResultAsync } from "neverthrow";
import type { MerchantLocation } from "@yourtal/contracts/listing/merchant-location";
import type { ListLocationsError } from "../store.errors";
import type { LocationRepository } from "../persistence/location.repository";
import { wrapPersistence } from "../wrap-persistence";

export function listLocations(
  locations: LocationRepository,
  merchantId: string,
): ResultAsync<readonly MerchantLocation[], ListLocationsError> {
  return wrapPersistence(locations.listOwned(merchantId));
}
