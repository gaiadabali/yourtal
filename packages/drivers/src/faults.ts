/**
 * The named ways an external boundary goes wrong. YT-0536.
 *
 * ## Why a catalogue instead of per-test mocking
 *
 * A simulator that only succeeds ships code whose error handling has never
 * executed. That is `docs/03` risk 37 — guarantees green in CI by never
 * running — and holding every third-party connection makes it worse, because
 * now the happy path is the *only* path anyone has seen.
 *
 * Per-test ad-hoc mocking does not fix it. Each test invents its own idea of
 * "the payment failed", so the failures that get tested are the ones someone
 * thought of, one boundary at a time, and no two boundaries agree on what a
 * timeout looks like. A named catalogue makes the set of faults a property of
 * the platform rather than of whoever wrote the test: every boundary faces
 * the same five, and a boundary missing an unhappy-path test is visible
 * because the list is finite and shared.
 *
 * ## Why these five
 *
 * Each is a distinct failure *of the caller's logic*, not just a different
 * error code. They are the ones that produce wrong state rather than a
 * visible error:
 *
 * - `decline` — the call worked and the answer was no. The most-forgotten
 *   case, because it is not an exception anywhere.
 * - `timeout` — no answer. **The dangerous one: the operation may have
 *   succeeded on the far side.** Any caller that retries without an
 *   idempotency key can double-charge here.
 * - `duplicate_webhook` — the same event delivered twice. Every real payment
 *   provider does this; at-least-once is the normal guarantee.
 * - `out_of_order_webhook` — `settled` arriving before `pending`. A caller
 *   that treats webhooks as a sequence writes the older state last.
 * - `transient_5xx_then_success` — fails, then works. Distinguishes a caller
 *   that retries from one that gives up, and catches a retry that is not
 *   idempotent.
 */

export const FAULT_KINDS = [
  "decline",
  "timeout",
  "duplicate_webhook",
  "out_of_order_webhook",
  "transient_5xx_then_success",
] as const;

export type FaultKind = (typeof FAULT_KINDS)[number];

export interface FaultDefinition {
  readonly kind: FaultKind;
  /** What the far side does. */
  readonly behaviour: string;
  /** The caller bug this is here to catch. */
  readonly catches: string;
}

export const FAULT_CATALOGUE: Record<FaultKind, FaultDefinition> = {
  decline: {
    kind: "decline",
    behaviour: "The call completes normally and the answer is no.",
    catches:
      "A caller that treats 'no exception' as 'it worked'. A declined payment that credits points is " +
      "the worst version of this, and nothing throws.",
  },
  timeout: {
    kind: "timeout",
    behaviour: "No response arrives. The operation may or may not have happened on the far side.",
    catches:
      "A caller that retries without an idempotency key, which double-charges exactly here. " +
      "Also a caller that reports failure to the user for an operation that in fact succeeded.",
  },
  duplicate_webhook: {
    kind: "duplicate_webhook",
    behaviour: "The same event is delivered twice, with the same id.",
    catches:
      "A handler that is not idempotent. At-least-once is the normal guarantee from every real " +
      "provider, so this is ordinary traffic rather than an edge case.",
  },
  out_of_order_webhook: {
    kind: "out_of_order_webhook",
    behaviour: "A later event is delivered before an earlier one.",
    catches:
      "A handler that applies events in arrival order, which writes the stale state last and leaves " +
      "a settled payment marked pending forever.",
  },
  transient_5xx_then_success: {
    kind: "transient_5xx_then_success",
    behaviour: "The first attempt fails with a server error; a retry succeeds.",
    catches:
      "A caller that gives up on the first failure, and — the other way round — a retry that is not " +
      "idempotent and so performs the operation twice.",
  },
};

/**
 * How a simulator should misbehave for one call.
 *
 * `undefined` means behave. Deliberately explicit rather than a probability:
 * a simulator that fails randomly makes a test flaky, and a flaky test gets
 * retried until it passes, which is how a real failure becomes invisible.
 */
export interface FaultPlan {
  readonly kind: FaultKind;
  /**
   * For `transient_5xx_then_success`, how many attempts fail before one
   * works. Ignored by the other kinds.
   */
  readonly failuresBeforeSuccess?: number;
}

export function faultDefinition(kind: FaultKind): FaultDefinition {
  return FAULT_CATALOGUE[kind];
}
