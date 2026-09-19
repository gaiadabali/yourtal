import { errAsync } from "neverthrow";
import type { ResultAsync } from "neverthrow";
import type { SubmitKybDocumentError } from "../business.errors";
import type { KybDocument } from "@yourtal/contracts/business/kyb-document";
import type { BusinessAccountRepository } from "../persistence/business-account.repository";
import type {
  KybDocumentRepository,
  SubmitKybDocumentInput,
} from "../persistence/kyb-document.repository";
import { wrapPersistence } from "../wrap-persistence";

export function submitKybDocument(
  businesses: BusinessAccountRepository,
  kybDocuments: KybDocumentRepository,
  input: SubmitKybDocumentInput,
): ResultAsync<KybDocument, SubmitKybDocumentError> {
  return wrapPersistence(businesses.findById(input.businessId)).andThen((business) =>
    business === null
      ? errAsync<KybDocument, SubmitKybDocumentError>({
          type: "business_not_found",
          businessId: input.businessId,
        })
      : wrapPersistence(kybDocuments.submit(input)),
  );
}
