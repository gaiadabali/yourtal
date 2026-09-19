import type { IdempotencyRecord } from "./record";

/**
 * Storage behind the idempotency middleware. YT-0039.
 *
 * ## `putIfAbsent` is the whole design
 *
 * There is deliberately no `get`-then-`put` pair on this interface, because
 * that pattern cannot be made safe. Two concurrent retries both read "no
 * record", both write, and both execute the value operation — the exact
 * double-spend this package exists to prevent, reintroduced by the shape of
 * the interface.
 *
 * `putIfAbsent` pushes the race down to where it can actually be won: a
 * single atomic operation. In Postgres that is
 * `INSERT ... ON CONFLICT DO NOTHING RETURNING`, whose return tells you
 * whether you were first. Any implementation that cannot do that atomically
 * is not a valid implementation of this interface.
 *
 * `docs/02` §17: *"Exactly-once is achieved by effectively-once, not by
 * wishing."* This interface is where that stops being a slogan.
 */
export interface IdempotencyStore {
  /**
   * Claims the key. Returns `undefined` if this caller won and the record
   * was written; returns the EXISTING record if someone else got there
   * first, so the caller can decide between replay, mismatch and in-progress
   * without a second round trip.
   *
   * Must be atomic. Must treat an expired record as absent — an expired row
   * is a key that may legitimately be reused, and a caller must not be told
   * "in progress" by a row that died three days ago.
   */
  putIfAbsent(record: IdempotencyRecord): Promise<IdempotencyRecord | undefined>;

  /**
   * Attaches the response and moves the record to `completed`. Called only
   * by the caller that won `putIfAbsent`.
   */
  complete(scope: string, key: string, response: { status: number; body: string }): Promise<void>;

  /**
   * Deletes an in-progress record without completing it.
   *
   * For requests that must stay retryable: `docs/12` is explicit that a
   * request which failed validation is not saved and is safe to retry. If
   * those rows survived, a client that fixed a typo in its body would be
   * told `fingerprint_mismatch` forever — punished for correcting the error
   * we asked them to correct.
   */
  abandon(scope: string, key: string): Promise<void>;

  /**
   * Removes records past `expiresAt`. Called by a scheduled job, not on the
   * request path. Returns how many were removed, for the job's own logging.
   */
  prune(now: Date): Promise<number>;
}
