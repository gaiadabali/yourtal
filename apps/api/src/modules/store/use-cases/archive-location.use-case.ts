import { errAsync, okAsync } from "neverthrow";
import type { ResultAsync } from "neverthrow";
import type { ArchiveLocationError } from "../store.errors";
import type { LocationRepository } from "../persistence/location.repository";
import { wrapPersistence } from "../wrap-persistence";

export function archiveLocation(
  locations: LocationRepository,
  merchantId: string,
  locationId: string,
): ResultAsync<void, ArchiveLocationError> {
  const result: ResultAsync<void, ArchiveLocationError> = wrapPersistence(
    locations.archive(merchantId, locationId),
  ).andThen((outcome) => {
    switch (outcome) {
      case "ok":
        return okAsync(undefined);
      case "not_found":
        return errAsync({ type: "location_not_found" as const, locationId });
      case "in_use":
        return errAsync({ type: "location_in_use" as const, locationId });
    }
  });
  return result;
}
