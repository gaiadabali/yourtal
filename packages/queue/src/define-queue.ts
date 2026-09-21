import type { PgBoss } from "pg-boss";
import {
  DEAD_LETTER_SUFFIX,
  DEFAULT_RETRY_BACKOFF,
  DEFAULT_RETRY_DELAY_MAX_SECONDS,
  DEFAULT_RETRY_DELAY_SECONDS,
  DEFAULT_RETRY_LIMIT,
  deadLetterQueueName,
} from "./config";

/**
 * Creates a queue and its dead-letter queue together. YT-0040 AC1.
 *
 * ## Order matters
 *
 * pg-boss validates a `deadLetter` reference at `createQueue` time
 * (`Attorney`/`Manager.createQueue`: `assertQueueName` + a cache lookup on
 * the referenced queue), and the migration's `dlq_fkey` enforces the same
 * thing at the database level. So the dead-letter queue is created FIRST,
 * with no dead-letter of its own — a dead-letter queue that could itself
 * dead-letter would need a second one, forever, and pg-boss's own
 * `deadLetter cannot be itself` assertion is the only cycle guard it has.
 *
 * ## Why the dead-letter queue's own retryLimit is 0
 *
 * A job that already exhausted its retries and landed here has nothing
 * left to retry into — retrying it would just be a second, hidden retry
 * budget nobody configured on purpose. Landing here IS the terminal state;
 * what happens next (alerting, a redrive, a human) is a decision for the
 * consumer reading this queue, not something pg-boss's own retry machinery
 * should attempt unasked.
 */
export interface DefineQueueOptions {
  readonly retryLimit?: number;
  readonly retryDelaySeconds?: number;
  readonly retryBackoff?: boolean;
  readonly retryDelayMaxSeconds?: number;
}

export interface DefinedQueue {
  readonly name: string;
  readonly deadLetterName: string;
}

export async function defineQueue(
  boss: PgBoss,
  name: string,
  options: DefineQueueOptions = {},
): Promise<DefinedQueue> {
  if (name.endsWith(DEAD_LETTER_SUFFIX)) {
    throw new Error(
      `defineQueue: "${name}" already looks like a dead-letter queue name (ends in "${DEAD_LETTER_SUFFIX}") — define the queue it belongs to instead, and its dead-letter queue is created for you`,
    );
  }

  const deadLetterName = deadLetterQueueName(name);

  await boss.createQueue(deadLetterName, {
    // Never itself dead-lettered — see the doc comment above.
    retryLimit: 0,
    partition: false,
  });

  await boss.createQueue(name, {
    retryLimit: options.retryLimit ?? DEFAULT_RETRY_LIMIT,
    retryDelay: options.retryDelaySeconds ?? DEFAULT_RETRY_DELAY_SECONDS,
    retryBackoff: options.retryBackoff ?? DEFAULT_RETRY_BACKOFF,
    retryDelayMax: options.retryDelayMaxSeconds ?? DEFAULT_RETRY_DELAY_MAX_SECONDS,
    deadLetter: deadLetterName,
    // Never true — see client.ts's doc comment on why the app role must
    // not trigger pg-boss's per-queue CREATE TABLE path.
    partition: false,
  });

  return { name, deadLetterName };
}
