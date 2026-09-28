import type { KybDocument } from "@yourtal/contracts/business/kyb-document";
import type { Business } from "@yourtal/contracts/business";

/**
 * TASKS.md 9.3.a: the staff console's Businesses zone. A separate
 * repository from `BusinessAccountRepository` (widely injected across this
 * module) rather than more methods bolted onto it -- staff review is a
 * distinct read/write shape (search across every business, not "this
 * tenant's own"), and keeping it separate means every EXISTING consumer of
 * `BUSINESS_ACCOUNT_REPOSITORY` is unaffected by this file.
 */
export interface StaffBusinessSummary {
  readonly id: string;
  readonly legalName: string;
  readonly displayName: string;
  readonly handle: string;
  readonly region: Business["region"];
  readonly isVerified: boolean;
  readonly suspendedAt: string | null;
  readonly createdAt: string;
}

export interface StaffBusinessDetail extends StaffBusinessSummary {
  readonly taxIdKind: Business["taxIdKind"];
  readonly taxIdValue: string;
  readonly suspendedReason: string | null;
  readonly kybDocuments: readonly KybDocument[];
}

export interface ListStaffBusinessesFilter {
  readonly search: string | null;
  readonly region: Business["region"] | null;
  readonly limit: number;
  readonly offset: number;
}

export interface ListStaffBusinessesResult {
  readonly businesses: readonly StaffBusinessSummary[];
  readonly total: number;
}

export interface StaffBusinessReviewRepository {
  list(filter: ListStaffBusinessesFilter): Promise<ListStaffBusinessesResult>;
  findById(businessId: string): Promise<StaffBusinessDetail | null>;
  /** Verifies the business and marks every `submitted` document `verified`. `null` if no such business. */
  approveKyb(businessId: string, staffUserId: string): Promise<StaffBusinessDetail | null>;
  /** Un-verifies the business and marks every `submitted` document `rejected`. `null` if no such business. */
  rejectKyb(businessId: string, staffUserId: string): Promise<StaffBusinessDetail | null>;
  suspend(
    businessId: string,
    staffUserId: string,
    reason: string,
  ): Promise<StaffBusinessDetail | null>;
  reinstate(businessId: string, staffUserId: string): Promise<StaffBusinessDetail | null>;
}

export const STAFF_BUSINESS_REVIEW_REPOSITORY = Symbol("STAFF_BUSINESS_REVIEW_REPOSITORY");
