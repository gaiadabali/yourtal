/**
 * Discriminated unions on `type` for every expected failure this module's
 * service can produce (docs/13b section 4), matching
 * `apps/api/src/modules/business/business.errors.ts`'s convention.
 * `to-http-exception.ts` is the one adapter that maps these to HTTP.
 */

export interface PersistenceFailedError {
  readonly type: "persistence_failed";
  readonly cause: string;
}

export interface EmailAlreadyRegisteredError {
  readonly type: "email_already_registered";
}

/**
 * Deliberately ONE case for "wrong password" and "no such account" — never
 * two. YT-0153's enumeration discipline: a login endpoint that can be asked
 * "does this email exist" and answers accurately is a free enumeration
 * oracle, the exact failure `docs/14` section 6 names for a redemption
 * lookup and which applies here without modification.
 */
export interface InvalidCredentialsError {
  readonly type: "invalid_credentials";
}

export interface ThrottledError {
  readonly type: "throttled";
  readonly retryAfterSeconds: number;
}

export interface SessionInvalidError {
  readonly type: "session_invalid";
}

/**
 * Collapses `ConsumeRefusal`'s three cases (`not_found`, `already_consumed`,
 * `expired`) into one for any caller outside this module — same reasoning
 * as `InvalidCredentialsError`. A confirm endpoint that could say WHICH of
 * the three happened would tell a prober whether a guessed token ever
 * existed. The distinction is not lost; it is logged inside
 * `auth.service.ts` before being collapsed here, the same split
 * `CheckpointService.refuse` makes for its own three-way refusal.
 */
export interface TokenInvalidError {
  readonly type: "token_invalid";
}

/**
 * Under 13, regardless of `TEEN_ACCOUNTS` — 1.4.b. Deliberately carries no
 * age, so the neutral refusal `to-http-exception.ts` builds from it cannot
 * be used to narrow down exactly how old the caller said they were.
 */
export interface TooYoungError {
  readonly type: "too_young";
}

/** `TEEN_ACCOUNTS` is off and the caller is under the jurisdiction's adult minimum — 1.4.b. */
export interface BelowMinimumAgeError {
  readonly type: "below_minimum_age";
}

/** `TEEN_ACCOUNTS` is on, the caller is 13-17, and no `guardianEmail` was given — 1.4.b/1.4.c. */
export interface GuardianEmailRequiredError {
  readonly type: "guardian_email_required";
}

export type RegisterError =
  | EmailAlreadyRegisteredError
  | TooYoungError
  | BelowMinimumAgeError
  | GuardianEmailRequiredError
  | PersistenceFailedError;

export type LoginError = InvalidCredentialsError | ThrottledError | PersistenceFailedError;

export type LogoutError = PersistenceFailedError;

export type ChangePasswordError =
  SessionInvalidError | InvalidCredentialsError | PersistenceFailedError;

/**
 * No error case at all beyond persistence: this is intentionally the one
 * operation that ALWAYS reports success at the service boundary, whether
 * or not the email is registered — see `auth.service.ts`'s
 * `requestPasswordReset`. Enumeration safety here means there is nothing
 * for a caller to branch on.
 */
export type RequestPasswordResetError = PersistenceFailedError;

export type ConfirmPasswordResetError = TokenInvalidError | PersistenceFailedError;

export type RequestEmailVerificationError = SessionInvalidError | PersistenceFailedError;

export type ConfirmEmailVerificationError = TokenInvalidError | PersistenceFailedError;
