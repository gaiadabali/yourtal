import type { PgBoss } from "pg-boss";
import type { IdempotentJobData } from "./idempotent-worker";

/**
 * The producer half of "idempotent by construction". YT-0040.
 *
 * `idempotentWorker` refuses to run a handler for a job with no
 * `idempotencyKey` — but that only catches the omission at delivery time,
 * after the job already exists. Enqueuing through this function instead of
 * a bare `boss.send()` means a job with no key can never be created in the
 * first place, which is the difference between "the consumer happens to
 * check" and "there is no path that skips it".
 */
export async function sendIdempotent(
  boss: PgBoss,
  queueName: string,
  data: IdempotentJobData,
): Promise<string | null> {
  if (typeof data.idempotencyKey !== "string" || data.idempotencyKey.length === 0) {
    throw new Error(`sendIdempotent: no idempotencyKey for a job on queue "${queueName}"`);
  }
  return boss.send(queueName, data);
}
