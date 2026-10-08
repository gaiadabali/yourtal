/**
 * 7.4.c: a request for more stock. Approval and minting through 4.5 are
 * Phase 9's (staff console) -- this module only records the request and
 * lets a business read its own.
 */
export interface VoucherBatchRequest {
  readonly id: string;
  readonly listingId: string;
  readonly merchantId: string;
  readonly quantity: number;
  readonly requestedBy: string;
  readonly reason: string | null;
  readonly state: "pending" | "approved" | "rejected";
  readonly approvedBy: string | null;
  readonly decidedAt: string | null;
  readonly mintedBatchId: string | null;
  readonly createdAt: string;
}

export interface CreateVoucherBatchRequestInput {
  readonly listingId: string;
  readonly quantity: number;
  readonly requestedBy: string;
  readonly reason: string | null;
}

export interface VoucherBatchRequestRepository {
  listOwned(merchantId: string): Promise<VoucherBatchRequest[]>;
  findOwnedById(merchantId: string, requestId: string): Promise<VoucherBatchRequest | null>;
  /** `null` if `listingId` does not belong to `merchantId`. */
  create(
    merchantId: string,
    input: CreateVoucherBatchRequestInput,
  ): Promise<VoucherBatchRequest | null>;

  // --- TASKS.md 9.2.c: the staff moderation queue. Cross-merchant, unlike everything above. ---

  /** Every request still `pending`, newest first. */
  listPending(): Promise<VoucherBatchRequest[]>;
  /** No merchant scoping -- a moderator reviews any business's request. */
  findById(requestId: string): Promise<VoucherBatchRequest | null>;
  /**
   * Claims a pending request for minting: `null` if it is not `pending`, or
   * if `approvedBy` is the same principal who requested it (the WHERE
   * clause that protects the data, docs/13c -- the same shape
   * `SettlementDecreaseRequestRepository.approve` uses). The caller mints
   * through 4.5's `VoucherInternalClient` BEFORE calling this, then records
   * the real `mintedBatchId` here in the same breath as flipping the state,
   * so a request is never left `approved` with no batch to show for it.
   * The same transaction raises the listing's `stock_remaining` (and, if
   * needed, `stock_total`) by the batch size, which is what checkout's
   * buyable gate reads (13.3.w).
   */
  approve(
    requestId: string,
    approvedBy: string,
    mintedBatchId: string,
  ): Promise<VoucherBatchRequest | null>;
  /** `null` if the request is not `pending`. */
  reject(requestId: string, decidedBy: string): Promise<VoucherBatchRequest | null>;
}

export const VOUCHER_BATCH_REQUEST_REPOSITORY = Symbol("VOUCHER_BATCH_REQUEST_REPOSITORY");
