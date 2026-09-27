import { errAsync } from "neverthrow";
import type { ResultAsync } from "neverthrow";
import type { SubmitKybDocumentError } from "../business.errors";
import type { KybDocument } from "@yourtal/contracts/business/kyb-document";
import type { KybObjectStorage } from "../object-storage/kyb-object-storage";
import type { BusinessAccountRepository } from "../persistence/business-account.repository";
import type {
  KybDocumentRepository,
  SubmitKybDocumentInput,
} from "../persistence/kyb-document.repository";
import { wrapPersistence } from "../wrap-persistence";

/**
 * TASKS.md 7.1.b: `storageRef` must point at a real upload, not a free
 * string the client typed in (docs/audit/2026-09-25/business-merchant.md).
 * The existence check runs after the business lookup but before the write —
 * a business that does not exist is still the more informative 404.
 */
export function submitKybDocument(
  businesses: BusinessAccountRepository,
  kybDocuments: KybDocumentRepository,
  objectStorage: KybObjectStorage,
  input: SubmitKybDocumentInput,
): ResultAsync<KybDocument, SubmitKybDocumentError> {
  return wrapPersistence(businesses.findById(input.businessId)).andThen((business) => {
    if (business === null) {
      return errAsync<KybDocument, SubmitKybDocumentError>({
        type: "business_not_found",
        businessId: input.businessId,
      });
    }
    return wrapPersistence(objectStorage.exists(input.storageRef)).andThen((uploaded) => {
      if (!uploaded) {
        return errAsync<KybDocument, SubmitKybDocumentError>({
          type: "storage_ref_not_uploaded",
          storageRef: input.storageRef,
        });
      }
      return wrapPersistence(kybDocuments.submit(input));
    });
  });
}
