import { ResultAsync } from "neverthrow";
import type { ListingPricingFailedError, PersistenceFailedError } from "./store.errors";
import { ListingPricingError } from "./persistence/price-listing";

/**
 * Every use-case in this module wraps a repository promise the same way —
 * mirrors `business/wrap-persistence.ts`.
 */
export function wrapPersistence<T>(promise: Promise<T>): ResultAsync<T, PersistenceFailedError> {
  return ResultAsync.fromPromise(promise, (cause): PersistenceFailedError => ({
    type: "persistence_failed",
    cause: String(cause),
  }));
}

/**
 * Like `wrapPersistence`, for the three call sites that can also throw
 * `ListingPricingError` (7.4.b: create, direct reprice, approved-decrease
 * reprice) — distinguished so the caller sees `listing_pricing_failed`
 * rather than an undifferentiated persistence error.
 */
export function wrapPricedPersistence<T>(
  promise: Promise<T>,
): ResultAsync<T, ListingPricingFailedError | PersistenceFailedError> {
  return ResultAsync.fromPromise(promise, (cause): ListingPricingFailedError | PersistenceFailedError =>
    cause instanceof ListingPricingError
      ? { type: "listing_pricing_failed", cause: cause.message }
      : { type: "persistence_failed", cause: String(cause) },
  );
}
