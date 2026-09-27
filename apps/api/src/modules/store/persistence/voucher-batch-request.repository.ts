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
}

export const VOUCHER_BATCH_REQUEST_REPOSITORY = Symbol("VOUCHER_BATCH_REQUEST_REPOSITORY");
