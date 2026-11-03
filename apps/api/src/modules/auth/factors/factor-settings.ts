import type { AppConfig } from "../../../config/app-config";

export type AuthFactorSettings = NonNullable<AppConfig["authFactors"]>;

/** How long a WebAuthn challenge or a pending code step stays answerable. */
export const CEREMONY_TTL_SECONDS = 5 * 60;

/** Adding a passkey or an authenticator app needs a sign-in at most this old. */
export const FRESH_SIGN_IN_MS = 15 * 60 * 1000;

/** How long an unfinished authenticator-app enrolment can still be confirmed. */
export const ENROLMENT_TTL_SECONDS = 10 * 60;

/**
 * How long after an account's first factor (added from a password alone) a
 * password reset removes every factor; see `FactorWindow`.
 */
export const FACTOR_WINDOW_MS = 72 * 60 * 60 * 1000;

/** How long a step-up (proving a passkey or code again) unlocks changes for. */
export const STEP_UP_TTL_SECONDS = 10 * 60;

/** Wrong codes allowed on one pending sign-in before it has to start again. */
export const PENDING_SIGN_IN_MAX_FAILURES = 5;
