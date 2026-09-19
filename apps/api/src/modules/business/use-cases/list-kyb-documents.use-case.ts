import { errAsync } from "neverthrow";
import type { ResultAsync } from "neverthrow";
import type { ListKybDocumentsError } from "../business.errors";
import type { KybDocument } from "@yourtal/contracts/business/kyb-document";
import type { BusinessAccountRepository } from "../persistence/business-account.repository";
import type { KybDocumentRepository } from "../persistence/kyb-document.repository";
import { wrapPersistence } from "../wrap-persistence";

export function listKybDocuments(
  businesses: BusinessAccountRepository,
  kybDocuments: KybDocumentRepository,
  businessId: string,
): ResultAsync<KybDocument[], ListKybDocumentsError> {
  return wrapPersistence(businesses.findById(businessId)).andThen((business) =>
    business === null
      ? errAsync<KybDocument[], ListKybDocumentsError>({ type: "business_not_found", businessId })
      : wrapPersistence(kybDocuments.listByBusiness(businessId)),
  );
}
