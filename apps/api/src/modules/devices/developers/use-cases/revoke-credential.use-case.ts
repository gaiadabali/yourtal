import { errAsync, okAsync } from "neverthrow";
import type { ResultAsync } from "neverthrow";
import type {
  VoucherError,
  VoucherInternalClient,
} from "../../../../shared/voucher-client/voucher-internal-client";
import type { DeveloperCredentialRepository } from "../persistence/developer-credential.repository";
import type { DevelopersDomainError } from "../developers.errors";
import { wrapPersistence } from "../../wrap-persistence";

export function revokeCredential(
  vouchers: VoucherInternalClient,
  credentials: DeveloperCredentialRepository,
  businessId: string,
  credentialId: string,
  revokedBy: string,
): ResultAsync<true, VoucherError | DevelopersDomainError> {
  return wrapPersistence(credentials.findById(credentialId)).andThen((row) => {
    if (row === null) {
      return errAsync<true, VoucherError | DevelopersDomainError>({
        type: "credential_not_found",
        credentialId,
      });
    }
    if (row.businessId !== businessId) {
      return errAsync<true, VoucherError | DevelopersDomainError>({
        type: "credential_not_owned",
        credentialId,
      });
    }
    return vouchers
      .revoke({ credentialId, revokedBy })
      .andThen(() => wrapPersistence(credentials.markRevoked(credentialId)))
      .andThen(() => okAsync(true as const));
  });
}
