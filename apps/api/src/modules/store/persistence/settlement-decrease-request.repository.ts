import type { SettlementValueChange } from "./listing.repository";

export type SettlementDecreaseRequestState = "pending" | "approved";

export interface SettlementDecreaseRequest {
  readonly id: string;
  readonly listingId: string;
  readonly requestedBy: string;
  readonly currentSettlementValueIdr: number;
  readonly proposedSettlementValueIdr: number;
  readonly reason: string | null;
  readonly state: SettlementDecreaseRequestState;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly createdAt: string;
}

export interface CreateSettlementDecreaseRequestInput {
  readonly listingId: string;
  readonly requestedBy: string;
  readonly currentSettlementValueIdr: number;
  readonly proposedSettlementValueIdr: number;
  readonly reason: string;
}

/**
 * The two-person-approval workflow for a material settlement-value decrease
 * (YT-0575). `policies/resource_policies/listing.yaml` has enforced this
 * shape since before there was anywhere for a refused request to go —
 * `nobody-approves-their-own-settlement-cut` and
 * `only-an-owner-or-admin-approves-the-cut` are the PDP side; this is the
 * storage side.
 */
export interface SettlementDecreaseRequestRepository {
  /**
   * The one outstanding request for a listing, or `null`. Enforces "at most
   * one pending request per listing" for the caller's error message; the
   * migration's partial unique index is what actually enforces it against a
   * race (docs/13c: a check that runs first can still lose one).
   */
  findPendingForListing(listingId: string): Promise<SettlementDecreaseRequest | null>;
  findById(listingId: string, requestId: string): Promise<SettlementDecreaseRequest | null>;
  create(input: CreateSettlementDecreaseRequestInput): Promise<SettlementDecreaseRequest>;
  /**
   * Claims the request and applies its settlement-value change in one
   * transaction, or does neither. `null` deliberately collapses three
   * refusal causes into one — not found, already resolved, and
   * self-approval — the same choice `services/voucher`'s `Minter.Approve`
   * makes for bulk issuance: `requested_by <> $approver` is a WHERE clause
   * on the claiming UPDATE, so a self-approval matches no row rather than
   * being caught by a check the caller remembered to run first.
   */
  approve(
    merchantId: string,
    listingId: string,
    requestId: string,
    approverId: string,
  ): Promise<SettlementValueChange | null>;
}

export const SETTLEMENT_DECREASE_REQUEST_REPOSITORY = Symbol(
  "SETTLEMENT_DECREASE_REQUEST_REPOSITORY",
);
