import type { ResultAsync } from "neverthrow";
import type { ListListingsError } from "../store.errors";
import type {
  SettlementDecreaseRequest,
  SettlementDecreaseRequestRepository,
} from "../persistence/settlement-decrease-request.repository";
import { wrapPersistence } from "../wrap-persistence";

/** 7.4.g: a business's own pending S-decrease proposals, across every listing it owns. */
export function listSettlementDecreases(
  requests: SettlementDecreaseRequestRepository,
  merchantId: string,
): ResultAsync<readonly SettlementDecreaseRequest[], ListListingsError> {
  return wrapPersistence(requests.listPendingForBusiness(merchantId));
}
