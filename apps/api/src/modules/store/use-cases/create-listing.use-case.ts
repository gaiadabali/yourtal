import type { ResultAsync } from "neverthrow";
import { errAsync } from "neverthrow";
import type { Listing } from "@yourtal/contracts/listing";
import { categoryRefusal } from "../../studio/use-cases/category-policy";
import type { CreateListingError } from "../store.errors";
import type { CreateListingInput, ListingRepository } from "../persistence/listing.repository";
import type { BusinessRegionLookup } from "../persistence/business-region-lookup";
import { wrapPersistence, wrapPricedPersistence } from "../wrap-persistence";

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
 *
 * 12.4.c (F83): `categoryRefusal` runs here too, the same 1.1.d policy
 * `create-campaign-draft.use-case.ts` already enforces for campaigns — a
 * `prohibited` category (region-dependent) is refused outright and an
 * `adult_only` one requires `audience: "adult"`. Run before the location
 * check below so a refused category never even reaches the repository
 * (`DrizzleListingRepository.create`'s own `initialLifecycleState` still
 * routes an `adult_only`-but-otherwise-valid listing to `pending_review`).
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
      const refusal = categoryRefusal(business.region, input.contentCategory, input.audience);
      if (refusal !== null) {
        return errAsync<Listing, CreateListingError>(refusal);
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
        return wrapPricedPersistence(
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
