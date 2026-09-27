import { errAsync, ResultAsync } from "neverthrow";
import type { CreateVoucherBatchRequestError } from "../store.errors";
import type {
  CreateVoucherBatchRequestInput,
  VoucherBatchRequest,
  VoucherBatchRequestRepository,
} from "../persistence/voucher-batch-request.repository";
import { wrapPersistence } from "../wrap-persistence";

/** 7.4.c: the request row only -- approval and minting through 4.5 are Phase 9's. */
export function createVoucherBatchRequest(
  requests: VoucherBatchRequestRepository,
  merchantId: string,
  input: CreateVoucherBatchRequestInput,
): ResultAsync<VoucherBatchRequest, CreateVoucherBatchRequestError> {
  return wrapPersistence(requests.create(merchantId, input)).andThen((request) => {
    if (request === null) {
      return errAsync<VoucherBatchRequest, CreateVoucherBatchRequestError>({
        type: "listing_not_found",
        listingId: input.listingId,
      });
    }
    return ResultAsync.fromSafePromise(Promise.resolve(request));
  });
}
