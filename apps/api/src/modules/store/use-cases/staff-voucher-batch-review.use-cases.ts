import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { VoucherBatchRequest } from "../persistence/voucher-batch-request.repository";
import type { VoucherBatchRequestRepository } from "../persistence/voucher-batch-request.repository";
import type { ListingRepository } from "../persistence/listing.repository";
import type { VoucherInternalClient } from "../../../shared/voucher-client/voucher-internal-client";
import type {
  ListVoucherBatchRequestsError,
  StaffApproveVoucherBatchError,
  StaffRejectVoucherBatchError,
} from "../store.errors";
import { wrapPersistence } from "../wrap-persistence";

/**
 * TASKS.md 9.2.c: the staff moderation queue's voucher-batch half.
 * `listPendingVoucherBatches` is a plain read; the other two mirror
 * `approve-settlement-decrease.use-case.ts`'s shape -- the repository's own
 * `WHERE state = 'pending' AND requested_by <> $approver` is what actually
 * refuses a stale or self-authored decision (docs/13c), not a check here.
 */

export function listPendingVoucherBatches(
  requests: VoucherBatchRequestRepository,
): ResultAsync<VoucherBatchRequest[], ListVoucherBatchRequestsError> {
  return wrapPersistence(requests.listPending());
}

export function approveVoucherBatchRequest(
  requests: VoucherBatchRequestRepository,
  listings: ListingRepository,
  vouchers: VoucherInternalClient,
  requestId: string,
  staffUserId: string,
): ResultAsync<VoucherBatchRequest, StaffApproveVoucherBatchError> {
  return wrapPersistence(requests.findById(requestId)).andThen((request) => {
    if (request === null || request.state !== "pending") {
      return errAsync<VoucherBatchRequest, StaffApproveVoucherBatchError>({
        type: "voucher_batch_request_not_found",
        requestId,
      });
    }
    return wrapPersistence(listings.findOwnedById(request.merchantId, request.listingId)).andThen(
      (listing) => {
        if (listing === null) {
          return errAsync<VoucherBatchRequest, StaffApproveVoucherBatchError>({
            type: "listing_not_found",
            listingId: request.listingId,
          });
        }
        // 4.5's real two-call shape (voucher-client.contract.spec.ts):
        // request the batch under the ORIGINAL merchant requester's name,
        // then approve it as this staff member -- the mint itself is
        // two-person approved at the voucher-internal layer too, not only
        // at this table's.
        return vouchers
          .requestBatch({
            listingId: request.listingId,
            merchantId: request.merchantId,
            currency: listing.currency,
            faceValueMinor: listing.faceValueMinor,
            quantity: request.quantity,
            partialRedemptionPolicy: listing.partialRedemptionPolicy,
            requestedBy: request.requestedBy,
          })
          .mapErr(
            (error): StaffApproveVoucherBatchError => ({
              type: "voucher_mint_failed",
              code: error.code,
              message: error.message,
            }),
          )
          .andThen((batch) =>
            vouchers
              .approveBatch({ batchId: batch.batchId, approvedBy: staffUserId })
              .mapErr(
                (error): StaffApproveVoucherBatchError => ({
                  type: "voucher_mint_failed",
                  code: error.code,
                  message: error.message,
                }),
              ),
          )
          .andThen((batch) =>
            wrapPersistence(
              requests.approve(requestId, staffUserId, batch.batchId),
            ).andThen((updated) =>
              updated === null
                ? errAsync<VoucherBatchRequest, StaffApproveVoucherBatchError>({
                    type: "voucher_batch_request_not_found",
                    requestId,
                  })
                : okAsync(updated),
            ),
          );
      },
    );
  });
}

export function rejectVoucherBatchRequest(
  requests: VoucherBatchRequestRepository,
  requestId: string,
  staffUserId: string,
): ResultAsync<VoucherBatchRequest, StaffRejectVoucherBatchError> {
  return wrapPersistence(requests.reject(requestId, staffUserId)).andThen((updated) =>
    updated === null
      ? errAsync<VoucherBatchRequest, StaffRejectVoucherBatchError>({
          type: "voucher_batch_request_not_found",
          requestId,
        })
      : okAsync(updated),
  );
}
