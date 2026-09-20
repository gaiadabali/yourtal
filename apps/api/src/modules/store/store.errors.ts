/**
 * Discriminated unions on `type` for every expected failure this module's
 * use-cases can produce (docs/13b section 4). `to-http-exception.ts` is the
 * one adapter that maps these to HTTP.
 */

export interface ListingNotFoundError {
  readonly type: "listing_not_found";
  readonly listingId: string;
}

export interface InvalidLocationsError {
  readonly type: "invalid_locations";
  readonly locationIds: readonly string[];
}

export interface InvalidLifecycleTransitionError {
  readonly type: "invalid_lifecycle_transition";
  readonly from: string;
  readonly to: string;
}

export interface PersistenceFailedError {
  readonly type: "persistence_failed";
  readonly cause: string;
}

export type CreateListingError = InvalidLocationsError | PersistenceFailedError;

export type EditListingError = ListingNotFoundError | PersistenceFailedError;

export type SetSettlementValueError = ListingNotFoundError | PersistenceFailedError;

export type SetListingLifecycleError =
  | ListingNotFoundError
  | InvalidLifecycleTransitionError
  | PersistenceFailedError;

export type GetListingError = ListingNotFoundError | PersistenceFailedError;

export type ListListingsError = PersistenceFailedError;
