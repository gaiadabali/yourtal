import type { PersistenceFailedError } from "../devices.errors";

export type { PersistenceFailedError } from "../devices.errors";

export interface CredentialNotFoundError {
  readonly type: "credential_not_found";
  readonly credentialId: string;
}

export interface CredentialNotOwnedError {
  readonly type: "credential_not_owned";
  readonly credentialId: string;
}

export type DevelopersDomainError =
  PersistenceFailedError | CredentialNotFoundError | CredentialNotOwnedError;
