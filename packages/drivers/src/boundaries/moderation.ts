import { type Result, err, ok } from "neverthrow";
import { type BoundaryFailure, FaultEngine, failureFor } from "../fault-engine";
import type { FaultPlan } from "../faults";
import type { DriverMode, Environment } from "../driver-mode";
import { refuseLiveDriver } from "../live-driver";

/**
 * Judging whether user-submitted text is publishable.
 *
 * ## `review` is a first-class verdict, not a failure
 *
 * Two outcomes would force every uncertain case into one of them, and both
 * choices are bad: auto-publishing borderline content, or silently binning
 * a legitimate review. A human queue is the honest third answer, and making
 * it a verdict means the queue has to exist before the feature ships.
 *
 * ## What the boundary must do when the model is down
 *
 * A `timeout` here has a tempting default — publish, because the user is
 * waiting. The driver deliberately does not choose: it returns the failure
 * and lets the caller decide, because "publish unmoderated when the
 * moderation service is unavailable" is a policy decision that belongs in
 * the open, not in an adapter's catch block.
 */

export type ModerationVerdict =
  | { readonly outcome: "allow" }
  | { readonly outcome: "block"; readonly category: string }
  | { readonly outcome: "review"; readonly reason: string };

export interface ModerationDriver {
  readonly mode: DriverMode;
  classify(text: string): Promise<Result<ModerationVerdict, BoundaryFailure>>;
}

/** Substrings the simulator reacts to, so a test can request an outcome. */
export const SIMULATED_MODERATION_TRIGGERS = {
  block: "sim-block-me",
  review: "sim-review-me",
} as const;

export function createSimulatedModeration(faultPlan?: FaultPlan): ModerationDriver {
  const engine = new FaultEngine(faultPlan);

  return {
    mode: "simulated",

    classify(text: string): Promise<Result<ModerationVerdict, BoundaryFailure>> {
      const directive = engine.nextCall();
      if (directive !== "proceed") {
        return Promise.resolve(err(failureFor("moderation", directive)));
      }

      if (text.includes(SIMULATED_MODERATION_TRIGGERS.block)) {
        return Promise.resolve(ok({ outcome: "block", category: "simulated_policy_violation" }));
      }
      if (text.includes(SIMULATED_MODERATION_TRIGGERS.review)) {
        return Promise.resolve(ok({ outcome: "review", reason: "simulated_uncertainty" }));
      }
      // An empty submission is a product bug upstream, not a moderation
      // question — flagged for review rather than allowed, so it surfaces.
      if (text.trim() === "") {
        return Promise.resolve(ok({ outcome: "review", reason: "empty_submission" }));
      }
      return Promise.resolve(ok({ outcome: "allow" }));
    },
  };
}

export function createModerationDriver(
  mode: DriverMode,
  _env: Environment,
  faultPlan?: FaultPlan,
): ModerationDriver {
  return mode === "simulated"
    ? createSimulatedModeration(faultPlan)
    : refuseLiveDriver("moderation");
}
