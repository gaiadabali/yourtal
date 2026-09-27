import type { ResultAsync } from "neverthrow";
import type { ListVoucherBatchRequestsError } from "../store.errors";
import type { VoucherBatchRequest, VoucherBatchRequestRepository } from "../persistence/voucher-batch-request.repository";
import { wrapPersistence } from "../wrap-persistence";

export function listVoucherBatchRequests(
  requests: VoucherBatchRequestRepository,
  merchantId: string,
): ResultAsync<readonly VoucherBatchRequest[], ListVoucherBatchRequestsError> {
  return wrapPersistence(requests.listOwned(merchantId));
}
