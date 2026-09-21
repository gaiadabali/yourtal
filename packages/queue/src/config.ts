/**
 * pg-boss defaults for this repo. YT-0040.
 *
 * Every queue this repo defines should go through `defineQueue`
 * (`./define-queue`) rather than calling `boss.createQueue` directly, so
 * retries, backoff and the dead-letter path are the same shape everywhere
 * instead of being re-decided per queue.
 */

/** The schema pg-boss owns. Kept at its own default rather than following
 * `docs/15`'s "schema per domain" convention (`ledger`, `business`,
 * `campaign`, ...) — this schema's contents are pg-boss's own migration
 * plan, not ours, and naming it to match our domains would suggest we
 * control its shape. See `packages/db/migrations/20260921234000_pgboss_schema.sql`
 * for why the app never creates or migrates it. */
export const PGBOSS_SCHEMA = "pgboss";

/**
 * Retry + backoff + dead-letter, applied to every queue `defineQueue`
 * creates unless overridden.
 *
 * `retryBackoff: true` with `retryDelay: 1` gives 1s/2s/4s/... (capped by
 * `retryDelayMax`) rather than pg-boss's un-configured default of no
 * backoff at all — a consumer failing because a downstream dependency is
 * briefly down should not retry at a fixed interval into the same outage.
 */
export const DEFAULT_RETRY_LIMIT = 5;
export const DEFAULT_RETRY_DELAY_SECONDS = 1;
export const DEFAULT_RETRY_BACKOFF = true;
export const DEFAULT_RETRY_DELAY_MAX_SECONDS = 60;

/**
 * The suffix `defineQueue` appends to a queue's name to name its dead-letter
 * queue. A fixed convention rather than a caller-supplied name, so a queue
 * called `notifications.send` always dead-letters to
 * `notifications.send.dlq` and nobody has to look it up.
 */
export const DEAD_LETTER_SUFFIX = ".dlq";

export function deadLetterQueueName(queueName: string): string {
  return `${queueName}${DEAD_LETTER_SUFFIX}`;
}
