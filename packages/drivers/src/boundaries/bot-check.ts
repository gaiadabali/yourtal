import { type Result, err, ok } from "neverthrow";
import { type BoundaryFailure, FaultEngine, failureFor } from "../fault-engine";
import type { FaultPlan } from "../faults";
import type { DriverMode, Environment } from "../driver-mode";
import { refuseLiveDriver } from "../live-driver";

/**
 * Proving a request came from a browser rather than a script (docs/08).
 *
 * ## The verify step is real code even when the token is simulated
 *
 * YT-0538 asks for this explicitly, and it is the difference between a
 * seam and a decoration. A simulator that returns `{ passed: true }` without
 * inspecting the token leaves the call site untested: nothing proves the
 * caller actually checks the result, passes the token through, or handles an
 * expired one. So the simulated tokens carry their own verdict and the
 * driver reads it — the same shape the real verify call has, minus the
 * network.
 *
 * ## The one boundary that can genuinely go live today
 *
 * Cloudflare publishes always-pass and always-fail test keys, and
 * `.env.example` already carries them, so this is the first boundary where
 * `live` could be implemented without a commercial relationship. It is not
 * implemented here because YT-0538 owns it — but it means the first real
 * driver will have the cheapest possible proving ground.
 */

/** Tokens the simulator understands. Shaped like an opaque vendor token. */
export const SIMULATED_BOT_TOKENS = {
  pass: "sim-bot-pass",
  fail: "sim-bot-fail",
  expired: "sim-bot-expired",
} as const;

export interface BotCheckVerdict {
  readonly passed: boolean;
  /** Why, for a log. Never shown to a user: it tells a scripter what to change. */
  readonly reason: "human" | "failed_challenge" | "expired_token" | "malformed_token";
}

export interface BotCheckDriver {
  readonly mode: DriverMode;
  verify(token: string): Promise<Result<BotCheckVerdict, BoundaryFailure>>;
}

export function createSimulatedBotCheck(faultPlan?: FaultPlan): BotCheckDriver {
  const engine = new FaultEngine(faultPlan);

  return {
    mode: "simulated",
    verify(token: string): Promise<Result<BotCheckVerdict, BoundaryFailure>> {
      const directive = engine.nextCall();
      if (directive !== "proceed") {
        return Promise.resolve(err(failureFor("bot_check", directive)));
      }

      // A verdict is NOT a failure: the call succeeded and the answer was
      // "not a human". Returning `err` for a failed challenge would make a
      // caller handle it as an outage, and the two need opposite responses —
      // one is retried, the other must not be.
      switch (token) {
        case SIMULATED_BOT_TOKENS.pass:
          return Promise.resolve(ok({ passed: true, reason: "human" }));
        case SIMULATED_BOT_TOKENS.fail:
          return Promise.resolve(ok({ passed: false, reason: "failed_challenge" }));
        case SIMULATED_BOT_TOKENS.expired:
          return Promise.resolve(ok({ passed: false, reason: "expired_token" }));
        default:
          return Promise.resolve(ok({ passed: false, reason: "malformed_token" }));
      }
    },
  };
}

export function createBotCheckDriver(
  mode: DriverMode,
  _env: Environment,
  faultPlan?: FaultPlan,
): BotCheckDriver {
  return mode === "simulated" ? createSimulatedBotCheck(faultPlan) : refuseLiveDriver("bot_check");
}
