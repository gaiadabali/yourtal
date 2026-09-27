/** Per-endpoint idempotency windows for this module — see `business/wrap-persistence.ts`'s sibling comment on why not one global TTL. */

/** Provisioning a device: a record a person would notice twice, nothing a queue retries for days. */
export const PROVISION_DEVICE_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Pairing and unlocking: short-lived, single-attempt operations a client retries within seconds. */
export const PAIR_DEVICE_RETENTION_MS = 5 * 60 * 1000;
