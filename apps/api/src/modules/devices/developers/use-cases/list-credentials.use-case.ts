import type { ResultAsync } from "neverthrow";
import type { MerchantDeveloperCredential } from "@yourtal/contracts/merchant/merchant-developer-credential";
import type { DeveloperCredentialRepository } from "../persistence/developer-credential.repository";
import type { PersistenceFailedError } from "../../devices.errors";
import { wrapPersistence } from "../../wrap-persistence";

/** Never returns a `secret` — a read-back is not issuance (secret is only ever shown once). */
export function listCredentials(
  credentials: DeveloperCredentialRepository,
  businessId: string,
): ResultAsync<readonly MerchantDeveloperCredential[], PersistenceFailedError> {
  return wrapPersistence(credentials.listForBusiness(businessId)).map((rows) =>
    rows.map((row) => ({
      credentialId: row.credentialId,
      label: row.label,
      sandbox: row.sandbox,
      state: row.state,
      issuedAt: row.createdAt.toISOString(),
    })),
  );
}
