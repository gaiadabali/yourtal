import { requestFingerprint } from "./fingerprint";
import { idempotencyRecordSchema } from "./record";
import type { IdempotencyOutcome } from "./outcome";
import type { IdempotencyStore } from "./store";

/**
 * The idempotency middleware's core. YT-0039.
 *
 * Framework-free on purpose: the NestJS interceptor, the Fastify hook and
 * the eventual Go middleware are all thin wrappers over `begin` and
 * `complete`. `docs/13a` fixes the order as
 * `... auth -> Cerbos -> idempotency -> module`, so by the time anything
 * here runs the principal is authenticated and authorized, and `scope` can
 * be taken from the principal rather than from anything the client sent.
 *
 * ## How to use it, and the one way to get it wrong
 *
 *     const outcome = await begin(store, {...});
 *     if (outcome.kind !== "proceed") return respondTo(outcome);
 *     try {
 *       const response = await runTheOperation();
 *       await complete(store, scope, key, response);   // even on 5xx
 *       return response;
 *     } catch (validationError) {
 *       await abandon(store, scope, key);              // stays retryable
 *       throw validationError;
 *     }
 *
 * **The way to get it wrong is to skip `complete` on the error path.** A
 * record left `in_progress` blocks every retry of that key until it expires
 * — which, for a voucher key retained for the voucher's life plus 30 days,
 * is a very long time to be unable to retry. That is why `complete` is
 * called for 5xx too, and `abandon` exists for the cases `docs/12` says must
 * stay retryable.
 */
export interface BeginRequest {
  /** From the authenticated principal. Never from the request body. */
  readonly scope: string;
  readonly key: string;
  readonly method: string;
  readonly path: string;
  /** The raw body bytes as received, before parsing. */
  readonly rawBody: string;
  /** Usually now. Injectable so tests need no clock control. */
  readonly startedAt: Date;
  /**
   * How long this key stays claimed. Per-endpoint, not global: `docs/14` §6
   * replays a merchant redemption for 24h, while `docs/12` keeps a voucher
   * key for the voucher's life plus 30 days.
   */
  readonly retentionMs: number;
}

export async function begin(
  store: IdempotencyStore,
  request: BeginRequest,
): Promise<IdempotencyOutcome> {
  const fingerprint = requestFingerprint(request.method, request.path, request.rawBody);

  const claim = idempotencyRecordSchema.parse({
    scope: request.scope,
    key: request.key,
    fingerprint,
    state: "in_progress",
    startedAt: request.startedAt.toISOString(),
    expiresAt: new Date(request.startedAt.getTime() + request.retentionMs).toISOString(),
  });

  const existing = await store.putIfAbsent(claim);
  if (existing === undefined) {
    return { kind: "proceed" };
  }

  // Checked BEFORE the state. A mismatched fingerprint is wrong whatever the
  // first request is doing, and telling a client "try again later" when their
  // request will never be accepted sends them into a retry loop.
  if (existing.fingerprint !== fingerprint) {
    return { kind: "fingerprint_mismatch" };
  }

  if (existing.state === "in_progress" || existing.response === undefined) {
    return { kind: "in_progress" };
  }

  return {
    kind: "replay",
    status: existing.response.status,
    body: existing.response.body,
  };
}

/**
 * Stores the response so retries replay it. Call this for **every** response
 * the operation actually produced, including 5xx — `docs/12` caches those
 * deliberately. Re-running a value operation because the first attempt
 * returned 500 is how a partial failure becomes a double charge.
 */
export async function complete(
  store: IdempotencyStore,
  scope: string,
  key: string,
  response: { status: number; body: string },
): Promise<void> {
  await store.complete(scope, key, response);
}

/**
 * Releases the key without storing a response, leaving it retryable.
 *
 * For requests that never reached the value path — `docs/12`: a request that
 * failed validation is not saved and is safe to retry. If we stored those,
 * a client correcting the very mistake we reported would then be told
 * `fingerprint_mismatch`, because the corrected body hashes differently.
 */
export async function abandon(store: IdempotencyStore, scope: string, key: string): Promise<void> {
  await store.abandon(scope, key);
}

/** 24 hours — `docs/14` §6, for merchant redemption responses. */
export const REDEMPTION_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * 30 days — the "late-arrival interval" half of `docs/12`'s rule for voucher
 * keys. The full rule is the voucher's own lifetime PLUS this, so a caller
 * issuing a voucher adds it to that voucher's expiry rather than using this
 * value alone.
 */
export const LATE_ARRIVAL_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
