import type { AppConfig } from "../../../config/app-config";

export type AuthFactorSettings = NonNullable<AppConfig["authFactors"]>;

/** How long a WebAuthn challenge or a pending code step stays answerable. */
export const CEREMONY_TTL_SECONDS = 5 * 60;

/** Adding a passkey or an authenticator app needs a sign-in at most this old. */
export const FRESH_SIGN_IN_MS = 15 * 60 * 1000;

/** How long an unfinished authenticator-app enrolment can still be confirmed. */
export const ENROLMENT_TTL_SECONDS = 10 * 60;

/** A session from a password reset counts as email-proven for this long. */
export const RESET_PROOF_TTL_SECONDS = 15 * 60;

/**
 * A factor added from a password alone, to an account with none, can be
 * removed by an email-proven session for this long after it was added: long
 * enough for the person to see the notice email and act on it.
 */
export const BOOTSTRAP_REMOVAL_WINDOW_MS = 72 * 60 * 60 * 1000;

/** True while a bootstrapped factor enrolled at `enrolledAt` is still removable by email proof. */
export function withinBootstrapWindow(
  bootstrapped: boolean,
  enrolledAt: Date | null,
  now: Date,
): boolean {
  return (
    bootstrapped &&
    enrolledAt !== null &&
    now.getTime() - enrolledAt.getTime() < BOOTSTRAP_REMOVAL_WINDOW_MS
  );
}

/** How long a step-up (proving a passkey or code again) unlocks changes for. */
export const STEP_UP_TTL_SECONDS = 10 * 60;

/** Wrong codes allowed on one pending sign-in before it has to start again. */
export const PENDING_SIGN_IN_MAX_FAILURES = 5;
