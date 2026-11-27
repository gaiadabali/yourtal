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

/** 9.1.c: the GOD notice is decided on approval; this route is for an already-approved teen. */
export interface GuardianConsentNotGrantedError {
  readonly type: "not_granted";
}

export type GetGuardianConsentError = GuardianTokenNotFoundError;
export type DecideGuardianGodNoticeError =
  GuardianTokenNotFoundError | GuardianConsentNotGrantedError;
export type ApproveGuardianConsentError =
  GuardianTokenNotFoundError | GuardianConsentAlreadyRevokedError;
export type RevokeGuardianConsentError =
  GuardianTokenNotFoundError | GuardianLedgerUnavailableError;
/** 12.4.b (#6): the token is dead once deletion has run once, the same way it is after a real revoke. */
export type DeleteGuardianAccountError = GuardianTokenNotFoundError;
