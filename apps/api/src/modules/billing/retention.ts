/**
 * How long a purchase's `Idempotency-Key` stays claimed. Longer than the
 * store module's 24h (`store/retention.ts`): a purchase moves real cash
 * through the simulated payments driver, and a retry queue draining a slow
 * failure days later must still replay rather than charge twice -- the same
 * reasoning `docs/12` gives for a voucher's own key.
 */
export const PURCHASE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
