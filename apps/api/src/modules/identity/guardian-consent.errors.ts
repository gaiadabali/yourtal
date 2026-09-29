/** Discriminated unions on `type` (docs/13b section 4), matching every other module's own `*.errors.ts`. */

/** No row for this token, at all -- collapses "never issued" and "typo'd" into one shape (no enumeration oracle). */
export interface GuardianTokenNotFoundError {
  readonly type: "not_found";
}

/** 12.1.a: "revoked is final for this link; re-approval is out of scope." */
export interface GuardianConsentAlreadyRevokedError {
  readonly type: "already_revoked";
}

export interface GuardianLedgerUnavailableError {
  readonly type: "ledger_unavailable";
  readonly cause: string;
}

export type GetGuardianConsentError = GuardianTokenNotFoundError;
export type ApproveGuardianConsentError =
  GuardianTokenNotFoundError | GuardianConsentAlreadyRevokedError;
export type RevokeGuardianConsentError =
  GuardianTokenNotFoundError | GuardianLedgerUnavailableError;
