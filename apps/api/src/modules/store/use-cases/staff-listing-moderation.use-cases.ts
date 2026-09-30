import { errAsync, ResultAsync } from "neverthrow";
import type { Audience } from "@yourtal/contracts/campaign";
import type { ContentCategory } from "@yourtal/jurisdiction/content-category";
import { categoryRefusal } from "../../studio/use-cases/category-policy";
import type { ListingModerationItem, ListingRepository } from "../persistence/listing.repository";
import type { ModerateListingError, PersistenceFailedError } from "../store.errors";
import { wrapPersistence } from "../wrap-persistence";

export type ListModerationQueueError = PersistenceFailedError;

export function listListingModerationQueue(
  listings: ListingRepository,
): ResultAsync<readonly ListingModerationItem[], ListModerationQueueError> {
  return wrapPersistence(listings.listPendingModeration());
}

/**
 * 12.4.c (F83): "confirm or change" (1.1.d) -- a moderator may correct a
 * misclassified audience/category before approving, re-checked through the
 * SAME `categoryRefusal` the business's own create/edit paths use (a
 * moderator's override is not exempt from the policy it enforces). Both
 * optional -- either omitted confirms the business's own declared value.
 */
export interface ListingModerationOverrides {
  readonly audience?: Audience | undefined;
  readonly contentCategory?: ContentCategory | undefined;
}

/** TASKS.md 9.2.a: ops approves a flagged listing -- it joins the public catalogue at `active`, same as an unflagged listing always has. */
export function approveListingModeration(
  listings: ListingRepository,
  listingId: string,
  overrides: ListingModerationOverrides,
): ResultAsync<ListingModerationItem, ModerateListingError> {
  return wrapPersistence(listings.findPendingModerationById(listingId)).andThen((pending) => {
    if (pending === null) {
      return errAsync<ListingModerationItem, ModerateListingError>({
        type: "invalid_lifecycle_transition",
        from: "pending_review",
        to: "active",
      });
    }

    const audience = overrides.audience ?? pending.audience;
    const contentCategory = overrides.contentCategory ?? pending.contentCategory;
    const refusal = categoryRefusal(pending.region, contentCategory, audience);
    if (refusal !== null) {
      return errAsync<ListingModerationItem, ModerateListingError>(refusal);
    }

    const applyOverrides =
      overrides.audience !== undefined || overrides.contentCategory !== undefined
        ? wrapPersistence(
            listings.updateFields(pending.merchantId, listingId, {
              audience: overrides.audience,
              contentCategory: overrides.contentCategory,
            }),
          )
        : ResultAsync.fromSafePromise(Promise.resolve(null));

    return applyOverrides.andThen(() =>
      wrapPersistence(listings.decideModeration(listingId, "active", null)).andThen((item) =>
        item === null
          ? errAsync<ListingModerationItem, ModerateListingError>({
              type: "invalid_lifecycle_transition",
              from: "pending_review",
              to: "active",
            })
          : ResultAsync.fromSafePromise(Promise.resolve(item)),
      ),
    );
  });
}

export function rejectListingModeration(
  listings: ListingRepository,
  listingId: string,
  reason: string,
): ResultAsync<ListingModerationItem, ModerateListingError> {
  return wrapPersistence(listings.decideModeration(listingId, "rejected", reason)).andThen(
    (item) =>
      item === null
        ? errAsync<ListingModerationItem, ModerateListingError>({
            type: "invalid_lifecycle_transition",
            from: "pending_review",
            to: "rejected",
          })
        : ResultAsync.fromSafePromise(Promise.resolve(item)),
  );
}
