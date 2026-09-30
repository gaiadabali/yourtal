import { errAsync, ResultAsync } from "neverthrow";
import type { Listing } from "@yourtal/contracts/listing";
import { categoryRefusal } from "../../studio/use-cases/category-policy";
import type { EditListingError } from "../store.errors";
import type { EditListingInput, ListingRepository } from "../persistence/listing.repository";
import { wrapPersistence } from "../wrap-persistence";

/**
 * Non-price, non-lifecycle fields only — see `edit-listing.schema.ts`.
 *
 * 12.4.c (F83): `contentCategory`/`audience` are now editable, so a merchant
 * could otherwise author an ordinary category and edit it into a prohibited
 * one, or off `adult` while still `adult_only`, after the fact. The existing
 * listing is fetched first so the merged (patch-or-existing) category and
 * audience can be re-checked through the SAME `categoryRefusal` create
 * already runs — the identical rule `update-campaign-draft.use-case.ts`
 * applies to campaign edits.
 */
export function editListing(
  listings: ListingRepository,
  merchantId: string,
  listingId: string,
  patch: EditListingInput,
): ResultAsync<Listing, EditListingError> {
  return wrapPersistence(listings.findOwnedById(merchantId, listingId)).andThen((existing) => {
    if (existing === null) {
      return errAsync<Listing, EditListingError>({ type: "listing_not_found", listingId });
    }
    const contentCategory = patch.contentCategory ?? existing.contentCategory;
    const audience = patch.audience ?? existing.audience;
    const refusal = categoryRefusal(existing.region, contentCategory, audience);
    if (refusal !== null) {
      return errAsync<Listing, EditListingError>(refusal);
    }
    return wrapPersistence(listings.updateFields(merchantId, listingId, patch)).andThen(
      (updated) => {
        if (updated === null) {
          return errAsync<Listing, EditListingError>({ type: "listing_not_found", listingId });
        }
        return ResultAsync.fromSafePromise(Promise.resolve(updated));
      },
    );
  });
}
