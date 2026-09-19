import type { FaultKind, FaultPlan } from "./faults";

/**
 * Applies a `FaultPlan` to a simulated boundary. YT-0536.
 *
 * Shared by every boundary rather than reimplemented per simulator, so that
 * "what a timeout looks like" is one answer across payments, OTP, messaging
 * and the rest. Eight simulators each with their own idea of failure is how
 * a caller ends up handling five shapes of the same event.
 *
 * Deterministic by construction: no randomness, no wall-clock sleeping. A
 * simulator that fails at random produces a flaky test, a flaky test gets
 * retried until it passes, and a real failure then hides inside the retry.
 */

/** What a simulated call should do on this attempt. */
export type CallDirective = "proceed" | "decline" | "timeout" | "server_error";

export class FaultEngine {
  private attempts = 0;

  constructor(private readonly plan?: FaultPlan) {}

  get kind(): FaultKind | undefined {
    return this.plan?.kind;
  }

  /**
   * Decides this attempt. Call exactly once per simulated operation, because
   * `transient_5xx_then_success` counts attempts.
   */
  nextCall(): CallDirective {
    this.attempts += 1;
    if (this.plan === undefined) return "proceed";

    switch (this.plan.kind) {
      case "decline":
        return "decline";
      case "timeout":
        return "timeout";
      case "transient_5xx_then_success":
        return this.attempts <= (this.plan.failuresBeforeSuccess ?? 1) ? "server_error" : "proceed";
      // Webhook faults are about DELIVERY, not about the call. The call
      // itself succeeds and `shapeDeliveries` does the damage — which is
      // exactly how they behave in production, and why a caller that only
      // tests the request path never sees them.
      case "duplicate_webhook":
      case "out_of_order_webhook":
        return "proceed";
    }
  }

  /**
   * Reshapes the events a boundary would deliver.
   *
   * At-least-once is the normal guarantee from a real provider, so duplicates
   * are ordinary traffic rather than an edge case, and ordering is never
   * promised across independent deliveries.
   */
  shapeDeliveries<T>(events: readonly T[]): T[] {
    if (this.plan === undefined) return [...events];

    switch (this.plan.kind) {
      case "duplicate_webhook":
        // Each event immediately after itself: the shape a handler is most
        // likely to survive by accident, and least likely to survive under
        // concurrency.
        return events.flatMap((event) => [event, event]);
      case "out_of_order_webhook":
        return [...events].reverse();
      default:
        return [...events];
    }
  }
}

/** A boundary call that did not produce the intended effect. */
export interface BoundaryFailure {
  readonly kind: "declined" | "timeout" | "server_error" | "not_implemented";
  readonly boundary: string;
  readonly detail: string;
  /**
   * Whether the far side may have performed the operation anyway.
   *
   * `true` for timeouts, and that is the whole reason this field exists: a
   * caller that retries an uncertain operation without an idempotency key
   * double-charges. Making the uncertainty part of the failure type means a
   * caller has to look at it.
   */
  readonly mayHaveSucceeded: boolean;
}

export function failureFor(
  boundary: string,
  directive: Exclude<CallDirective, "proceed">,
): BoundaryFailure {
  switch (directive) {
    case "decline":
      return {
        kind: "declined",
        boundary,
        detail: "The call completed and the answer was no.",
        mayHaveSucceeded: false,
      };
    case "timeout":
      return {
        kind: "timeout",
        boundary,
        detail: "No response. The operation may have completed on the far side.",
        mayHaveSucceeded: true,
      };
    case "server_error":
      return {
        kind: "server_error",
        boundary,
        detail: "The far side returned a server error. Retrying may succeed.",
        mayHaveSucceeded: true,
      };
  }
}
