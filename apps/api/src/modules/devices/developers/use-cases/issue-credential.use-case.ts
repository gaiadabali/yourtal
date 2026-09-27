import type { ResultAsync } from "neverthrow";
import type { MerchantDeveloperCredential } from "@yourtal/contracts/merchant/merchant-developer-credential";
import type {
  VoucherError,
  VoucherInternalClient,
} from "../../../../shared/voucher-client/voucher-internal-client";
import type {
  CreateDeveloperCredentialInput,
  DeveloperCredentialRepository,
} from "../persistence/developer-credential.repository";
import type { PersistenceFailedError } from "../../devices.errors";
import { wrapPersistence } from "../../wrap-persistence";

export interface IssueCredentialInput {
  readonly businessId: string;
  readonly label: string;
  readonly sandbox: boolean;
  readonly issuedBy: string;
}

/** TASKS.md 8.3.a: issues through the voucher service (4.5.d), then indexes it by business for Studio -> Developers. */
export function issueCredential(
  vouchers: VoucherInternalClient,
  credentials: DeveloperCredentialRepository,
  input: IssueCredentialInput,
): ResultAsync<MerchantDeveloperCredential, VoucherError | PersistenceFailedError> {
  return vouchers
    .issueMerchantCredential({
      merchantId: input.businessId,
      deviceId: input.label,
      issuedBy: input.issuedBy,
    })
    .andThen((issued) => {
      const row: CreateDeveloperCredentialInput = {
        credentialId: issued.credentialId,
        businessId: input.businessId,
        label: input.label,
        sandbox: input.sandbox,
        issuedBy: input.issuedBy,
      };
      return wrapPersistence(credentials.create(row)).map(() => ({
        credentialId: issued.credentialId,
        label: input.label,
        sandbox: input.sandbox,
        state: issued.state,
        secret: issued.secret,
        issuedAt: issued.issuedAt,
      }));
    });
}
