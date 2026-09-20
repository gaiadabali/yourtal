/**
 * How long an idempotency key stays claimed for this module's writes.
 * Mirrors `shared/idempotency/retention.ts`'s reasoning (docs/14 section 6)
 * without editing a file outside this module's path.
 *
 * 24 hours: creating a listing or repricing one are records a merchant would
 * notice twice, but neither holds value in flight the way a redemption does,
 * and nothing queues a retry for days.
 */
export const LISTING_WRITE_RETENTION_MS = 24 * 60 * 60 * 1000;
