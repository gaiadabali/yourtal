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

/**
 * TASKS.md 1.1.h: a listing's region and currency come from its business, so
 * creating one against a business id nothing has onboarded yet is refused
 * rather than falling back to a guess.
 */
export interface BusinessNotFoundError {
  readonly type: "business_not_found";
  readonly businessId: string;
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

/** Proposed value is not a decrease at all, or not a MATERIAL one (YT-0575). */
export interface NotAMaterialDecreaseError {
  readonly type: "not_a_material_decrease";
  readonly listingId: string;
}

/** A listing may have at most one pending decrease request at a time. */
export interface DecreaseAlreadyPendingError {
  readonly type: "decrease_already_pending";
  readonly listingId: string;
}

export interface SettlementDecreaseRequestNotFoundError {
  readonly type: "settlement_decrease_request_not_found";
  readonly requestId: string;
}

/**
 * Collapses "already resolved" and "self-approval" into one refusal —
 * mirroring `services/voucher`'s `Minter.Approve`, which reports one error
 * for the same two causes because the claiming WHERE clause cannot tell
 * them apart, and neither changes what the caller should do next: find the
 * other person, or check whether this was already handled.
 */
export interface ApprovalRefusedError {
  readonly type: "approval_refused";
  readonly requestId: string;
}

export type CreateListingError =
  | InvalidLocationsError
  | BusinessNotFoundError
  | PersistenceFailedError;

export type EditListingError = ListingNotFoundError | PersistenceFailedError;

export type SetSettlementValueError = ListingNotFoundError | PersistenceFailedError;

export type ProposeSettlementDecreaseError =
  | ListingNotFoundError
  | NotAMaterialDecreaseError
  | DecreaseAlreadyPendingError
  | PersistenceFailedError;

export type ApproveSettlementDecreaseError =
  | ListingNotFoundError
  | SettlementDecreaseRequestNotFoundError
  | ApprovalRefusedError
  | PersistenceFailedError;

export type SetListingLifecycleError =
  ListingNotFoundError | InvalidLifecycleTransitionError | PersistenceFailedError;

export type GetListingError = ListingNotFoundError | PersistenceFailedError;

export type ListListingsError = PersistenceFailedError;
