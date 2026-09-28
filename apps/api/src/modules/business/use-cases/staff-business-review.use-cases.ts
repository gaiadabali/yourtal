import { errAsync } from "neverthrow";
import type { ResultAsync } from "neverthrow";
import type { BusinessNotFoundError, PersistenceFailedError } from "../business.errors";
import type {
  ListStaffBusinessesFilter,
  ListStaffBusinessesResult,
  StaffBusinessDetail,
  StaffBusinessReviewRepository,
} from "../persistence/staff-business-review.repository";
import { wrapPersistence } from "../wrap-persistence";

/** TASKS.md 9.3.a: the staff console's Businesses zone -- one thin wrap per action, same "business_not_found or the row" shape throughout. */

export type StaffBusinessReviewError = BusinessNotFoundError | PersistenceFailedError;

export function listBusinessesForStaff(
  businesses: StaffBusinessReviewRepository,
  filter: ListStaffBusinessesFilter,
): ResultAsync<ListStaffBusinessesResult, PersistenceFailedError> {
  return wrapPersistence(businesses.list(filter));
}

export function getBusinessForStaff(
  businesses: StaffBusinessReviewRepository,
  businessId: string,
): ResultAsync<StaffBusinessDetail, StaffBusinessReviewError> {
  return wrapPersistence(businesses.findById(businessId)).andThen((row) =>
    row === null
      ? errAsync<StaffBusinessDetail, StaffBusinessReviewError>({
          type: "business_not_found",
          businessId,
        })
      : wrapPersistence(Promise.resolve(row)),
  );
}

export function approveBusinessKyb(
  businesses: StaffBusinessReviewRepository,
  businessId: string,
  staffUserId: string,
): ResultAsync<StaffBusinessDetail, StaffBusinessReviewError> {
  return wrapPersistence(businesses.approveKyb(businessId, staffUserId)).andThen((row) =>
    row === null
      ? errAsync<StaffBusinessDetail, StaffBusinessReviewError>({
          type: "business_not_found",
          businessId,
        })
      : wrapPersistence(Promise.resolve(row)),
  );
}

export function rejectBusinessKyb(
  businesses: StaffBusinessReviewRepository,
  businessId: string,
  staffUserId: string,
): ResultAsync<StaffBusinessDetail, StaffBusinessReviewError> {
  return wrapPersistence(businesses.rejectKyb(businessId, staffUserId)).andThen((row) =>
    row === null
      ? errAsync<StaffBusinessDetail, StaffBusinessReviewError>({
          type: "business_not_found",
          businessId,
        })
      : wrapPersistence(Promise.resolve(row)),
  );
}

export function suspendBusiness(
  businesses: StaffBusinessReviewRepository,
  businessId: string,
  staffUserId: string,
  reason: string,
): ResultAsync<StaffBusinessDetail, StaffBusinessReviewError> {
  return wrapPersistence(businesses.suspend(businessId, staffUserId, reason)).andThen((row) =>
    row === null
      ? errAsync<StaffBusinessDetail, StaffBusinessReviewError>({
          type: "business_not_found",
          businessId,
        })
      : wrapPersistence(Promise.resolve(row)),
  );
}

export function reinstateBusiness(
  businesses: StaffBusinessReviewRepository,
  businessId: string,
  staffUserId: string,
): ResultAsync<StaffBusinessDetail, StaffBusinessReviewError> {
  return wrapPersistence(businesses.reinstate(businessId, staffUserId)).andThen((row) =>
    row === null
      ? errAsync<StaffBusinessDetail, StaffBusinessReviewError>({
          type: "business_not_found",
          businessId,
        })
      : wrapPersistence(Promise.resolve(row)),
  );
}
