import type { PersistenceFailedError, SessionInvalidError, ThrottledError } from "../auth.errors";

/** A code, passkey response or challenge that did not check out. One shape for every cause. */
export interface FactorInvalidError {
  readonly type: "factor_invalid";
}

/** Adding a sign-in method needs a recent sign-in, not just any live session. */
export interface ReauthenticationRequiredError {
  readonly type: "reauthentication_required";
}

export interface TotpAlreadyEnabledError {
  readonly type: "totp_already_enabled";
}

export interface TotpNotEnabledError {
  readonly type: "totp_not_enabled";
}

export interface PasskeyNotFoundError {
  readonly type: "passkey_not_found";
}

export interface LastSignInMethodError {
  readonly type: "last_sign_in_method";
}

/** Passkeys or codes are not configured on this deployment. */
export interface FactorsUnavailableError {
  readonly type: "factors_unavailable";
}

export type FactorError =
  | FactorInvalidError
  | ReauthenticationRequiredError
  | TotpAlreadyEnabledError
  | TotpNotEnabledError
  | PasskeyNotFoundError
  | LastSignInMethodError
  | FactorsUnavailableError
  | SessionInvalidError
  | ThrottledError
  | PersistenceFailedError;
