import { errAsync } from "neverthrow";
import type { ResultAsync } from "neverthrow";
import type { MerchantDeveloperCredential } from "@yourtal/contracts/merchant/merchant-developer-credential";
import type {
  VoucherError,
  VoucherInternalClient,
} from "../../../../shared/voucher-client/voucher-internal-client";
import type { DeveloperCredentialRepository } from "../persistence/developer-credential.repository";
import type { DevelopersDomainError } from "../developers.errors";
import { wrapPersistence } from "../../wrap-persistence";

/** TASKS.md 8.3.a: only the caller's OWN business may rotate its own credential. */
export function rotateCredential(
  vouchers: VoucherInternalClient,
  credentials: DeveloperCredentialRepository,
  businessId: string,
  credentialId: string,
  rotatedBy: string,
): ResultAsync<MerchantDeveloperCredential, VoucherError | DevelopersDomainError> {
  return wrapPersistence(credentials.findById(credentialId)).andThen((row) => {
    if (row === null) {
      return errAsync<MerchantDeveloperCredential, VoucherError | DevelopersDomainError>({
        type: "credential_not_found",
        credentialId,
      });
    }
    if (row.businessId !== businessId) {
      return errAsync<MerchantDeveloperCredential, VoucherError | DevelopersDomainError>({
        type: "credential_not_owned",
        credentialId,
      });
    }
    return vouchers.rotate({ credentialId, rotatedBy }).map((rotated) => ({
      credentialId: rotated.credentialId,
      label: row.label,
      sandbox: row.sandbox,
      state: rotated.state,
      secret: rotated.secret,
      issuedAt: rotated.issuedAt,
    }));
  });
}
