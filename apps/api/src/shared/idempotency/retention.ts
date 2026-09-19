/**
 * How long an idempotency key stays claimed, per class of endpoint. YT-0039.
 *
 * Deliberately not one global TTL. `docs/14` §6 replays a merchant
 * redemption for 24 hours; `docs/12` keeps a voucher key for the voucher's
 * own lifetime plus a 30-day late-arrival interval, following Amazon's rule
 * of "resource lifetime plus a late-arrival interval". A single global 24h
 * would silently expire a voucher key that a merchant's retry queue drains a
 * week later, and the replay would become a second issuance.
 *
 * So each endpoint names the window that fits what it creates, and the
 * question "how long could a retry of this plausibly arrive?" gets asked
 * once per endpoint rather than never.
 */

/**
 * 24 hours, for onboarding writes — creating a business, inviting a member,
 * submitting a KYB document.
 *
 * These create records a person would notice twice, but nothing that holds
 * value and nothing a queue retries for days. A client retrying an
 * onboarding call beyond a day has almost certainly been restarted with
 * fresh state, and would send a fresh key anyway.
 */
export const ONBOARDING_RETENTION_MS = 24 * 60 * 60 * 1000;
