import type { ResultAsync } from "neverthrow";
import { errAsync } from "neverthrow";
import type { Listing } from "@yourtal/contracts/listing";
import type { CreateListingError } from "../store.errors";
import type { CreateListingInput, ListingRepository } from "../persistence/listing.repository";
import type { BusinessRegionLookup } from "../persistence/business-region-lookup";
import { wrapPersistence } from "../wrap-persistence";

/**
 * Creates a listing, straight to `active` — there is no draft or
 * ops-approval step in this pass (see the module's migration header and the
 * ticket report on `approve_listing`/`reject_listing`).
 *
 * The location check runs BEFORE the insert rather than relying on a
 * database constraint, because there is no FK from `listing_location` back
 * to "this merchant" to violate — the constraint that exists
 * (`vouchers_location_is_offered_by_its_listing`) is about a voucher naming
 * one of ITS OWN listing's branches, not about a branch belonging to the
 * merchant creating the listing.
 *
 * `region` and `currency` are resolved from the business here, never taken
 * from the caller (TASKS.md 1.1.h) — `businessSchema.region` is immutable
 * and its `currency` is a pure function of it (F2), so the request body
 * naming either would just be a second, potentially-mismatched copy of a
 * fact the business row already states.
 */
export function createListing(
  listings: ListingRepository,
  businessRegionLookup: BusinessRegionLookup,
  merchantId: string,
  input: Omit<CreateListingInput, "region" | "currency">,
): ResultAsync<Listing, CreateListingError> {
  return wrapPersistence(businessRegionLookup.findRegionAndCurrency(merchantId)).andThen(
    (business) => {
      if (business === null) {
        return errAsync<Listing, CreateListingError>({
          type: "business_not_found",
          businessId: merchantId,
        });
      }
      return wrapPersistence(
        listings.locationsBelongToMerchant(merchantId, input.locationIds),
      ).andThen((valid) => {
        if (!valid) {
          return errAsync<Listing, CreateListingError>({
            type: "invalid_locations",
            locationIds: input.locationIds,
          });
        }
        return wrapPersistence(
          listings.create(merchantId, {
            ...input,
            region: business.region,
            currency: business.currency,
          }),
        );
      });
    },
  );
}
