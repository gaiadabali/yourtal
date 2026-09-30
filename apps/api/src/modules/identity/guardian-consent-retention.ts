/**
 * Idempotency retention for the guardian consent routes (12.1.a), following
 * `auth/idempotency-retention.ts`'s own rule: kept local to this module,
 * one window per endpoint, judged by how long a retry could plausibly
 * arrive rather than sharing one global TTL.
 */

/** A guardian re-submitting a stuck "Approve" tap — the same shape REGISTER_RETENTION_MS already picks for a one-off account action. */
export const APPROVE_GUARDIAN_CONSENT_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Same window as approve — a revoke retry is exactly as plausible over the same timescale. */
export const REVOKE_GUARDIAN_CONSENT_RETENTION_MS = 24 * 60 * 60 * 1000;

/** 12.4.b (#6): same window again — a guardian re-submitting a stuck "Delete account" tap. */
export const DELETE_GUARDIAN_ACCOUNT_RETENTION_MS = 24 * 60 * 60 * 1000;
