import { errAsync, okAsync } from "neverthrow";
import type { ResultAsync } from "neverthrow";
import type { Business } from "@yourtal/contracts/business";
import type { UpdateChannelSettingsError } from "../business.errors";
import type {
  BusinessAccountRepository,
  UpdateChannelInput,
} from "../persistence/business-account.repository";
import { wrapPersistence } from "../wrap-persistence";

/** Changes the public channel identity only: name, handle, logo and cover. Region never moves. */
export function updateChannelSettings(
  businesses: BusinessAccountRepository,
  input: UpdateChannelInput,
): ResultAsync<Business, UpdateChannelSettingsError> {
  return wrapPersistence(businesses.updateChannel(input)).andThen((outcome) => {
    if (outcome === null) {
      return errAsync<Business, UpdateChannelSettingsError>({
        type: "business_not_found",
        businessId: input.businessId,
      });
    }
    if (outcome === "handle_taken") {
      return errAsync<Business, UpdateChannelSettingsError>({
        type: "handle_taken",
        handle: input.handle,
      });
    }
    return okAsync<Business, UpdateChannelSettingsError>(outcome);
  });
}
