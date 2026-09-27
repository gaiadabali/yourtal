import { errAsync, ResultAsync } from "neverthrow";
import type { GetVoucherBatchRequestError } from "../store.errors";
import type {
  VoucherBatchRequest,
  VoucherBatchRequestRepository,
} from "../persistence/voucher-batch-request.repository";
import { wrapPersistence } from "../wrap-persistence";

export function getVoucherBatchRequest(
  requests: VoucherBatchRequestRepository,
  merchantId: string,
  requestId: string,
): ResultAsync<VoucherBatchRequest, GetVoucherBatchRequestError> {
  return wrapPersistence(requests.findOwnedById(merchantId, requestId)).andThen((request) => {
    if (request === null) {
      return errAsync<VoucherBatchRequest, GetVoucherBatchRequestError>({
        type: "voucher_batch_request_not_found",
        requestId,
      });
    }
    return ResultAsync.fromSafePromise(Promise.resolve(request));
  });
}
