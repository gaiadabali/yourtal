/**
 * Per-endpoint idempotency retention for this module, following
 * `shared/idempotency/retention.ts`'s own rule: each window names how long
 * a retry of THAT endpoint could plausibly arrive, rather than sharing one
 * global TTL. Kept local to this module rather than added to the shared
 * file — these are auth-specific judgements, not durations another module
 * would reuse.
 */

/** Matches `ONBOARDING_RETENTION_MS` — registering an account is the same
 * shape of write as creating a business or inviting a member: a record a
 * person would notice twice, nothing that holds value. */
export const REGISTER_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Matches the verification token's own TTL (`EMAIL_VERIFICATION_TTL_MS`). */
export const CONFIRM_EMAIL_VERIFICATION_RETENTION_MS = 24 * 60 * 60 * 1000;
