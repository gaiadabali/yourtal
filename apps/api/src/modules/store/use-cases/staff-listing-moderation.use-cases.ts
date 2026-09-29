import { errAsync, ResultAsync } from "neverthrow";
import type { ListingModerationItem, ListingRepository } from "../persistence/listing.repository";
import type { InvalidLifecycleTransitionError, PersistenceFailedError } from "../store.errors";
import { wrapPersistence } from "../wrap-persistence";

export type ListModerationQueueError = PersistenceFailedError;

export function listListingModerationQueue(
  listings: ListingRepository,
): ResultAsync<readonly ListingModerationItem[], ListModerationQueueError> {
  return wrapPersistence(listings.listPendingModeration());
}

export type ModerateListingError = InvalidLifecycleTransitionError | PersistenceFailedError;

/** TASKS.md 9.2.a: ops approves a flagged listing -- it joins the public catalogue at `active`, same as an unflagged listing always has. */
export function approveListingModeration(
  listings: ListingRepository,
  listingId: string,
): ResultAsync<ListingModerationItem, ModerateListingError> {
  return wrapPersistence(listings.decideModeration(listingId, "active", null)).andThen((item) =>
    item === null
      ? errAsync<ListingModerationItem, ModerateListingError>({
          type: "invalid_lifecycle_transition",
          from: "pending_review",
          to: "active",
        })
      : ResultAsync.fromSafePromise(Promise.resolve(item)),
  );
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
