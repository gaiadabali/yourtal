import type { PersistenceFailedError, SessionInvalidError, ThrottledError } from "../auth.errors";

/** A code, passkey response or challenge that did not check out. One shape for every cause. */
export interface FactorInvalidError {
  readonly type: "factor_invalid";
}

/** Adding a sign-in method needs a recent sign-in, not just any live session. */
export interface ReauthenticationRequiredError {
  readonly type: "reauthentication_required";
}

/**
 * The account already has a passkey or an authenticator app, so changing its
 * sign-in methods needs one of them: a session signed in with it (amr hwk or
 * mfa) or a step-up just now. A password alone is not enough.
 */
export interface StepUpRequiredError {
  readonly type: "step_up_required";
}

/** Authenticator apps are switched off on this deployment (no seed key). */
export interface AuthenticatorUnavailableError {
  readonly type: "authenticator_unavailable";
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
  | StepUpRequiredError
  | AuthenticatorUnavailableError
  | TotpAlreadyEnabledError
  | TotpNotEnabledError
  | PasskeyNotFoundError
  | LastSignInMethodError
  | FactorsUnavailableError
  | SessionInvalidError
  | ThrottledError
  | PersistenceFailedError;
