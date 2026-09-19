/**
 * What `begin()` tells the caller to do. YT-0039.
 *
 * Four outcomes, and the caller must handle all four — which is why this is
 * a discriminated union rather than a nullable cached response. The tempting
 * shape is `Promise<CachedResponse | null>`, where null means "go ahead".
 * That collapses `conflict` and `in_progress` into "no cached response" and
 * re-executes a value operation in exactly the two cases where it must not.
 */
export type IdempotencyOutcome =
  /**
   * No prior record. The caller executes the operation and MUST then call
   * `complete()` or `abandon()` — a record left `in_progress` blocks every
   * retry of that key until it expires.
   */
  | { readonly kind: "proceed" }
  /**
   * A completed record with a matching fingerprint. Return this response
   * verbatim and do not execute. Includes stored 5xx responses: replaying
   * the original failure is correct, re-running the operation is not.
   */
  | { readonly kind: "replay"; readonly status: number; readonly body: string }
  /**
   * Same key, different request. `docs/12`: return `idempotency_error` with
   * 409. Never replay — the stored response answers a different question.
   */
  | { readonly kind: "fingerprint_mismatch" }
  /**
   * The first request with this key is still running. 409 as well, but a
   * distinct kind because the client's correct action differs: retry later,
   * rather than fix the request. Collapsing the two would tell a client to
   * change a request that was perfectly correct.
   */
  | { readonly kind: "in_progress" };

/** Renders an outcome for a log line. */
export function describeOutcome(outcome: IdempotencyOutcome): string {
  switch (outcome.kind) {
    case "proceed":
      return "no prior record; executing";
    case "replay":
      return `replaying stored ${String(outcome.status)}`;
    case "fingerprint_mismatch":
      return "key reused with a different request";
    case "in_progress":
      return "first request with this key is still running";
    default: {
      const unreachable: never = outcome;
      return String(unreachable);
    }
  }
}
