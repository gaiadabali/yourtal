import { type Result, err, ok } from "neverthrow";
import { type BoundaryFailure, FaultEngine, failureFor } from "../fault-engine";
import type { FaultPlan } from "../faults";
import type { DriverMode, Environment } from "../driver-mode";
import { refuseLiveDriver } from "../live-driver";

/**
 * Phone verification.
 *
 * ## Why this simulator is stricter than it needs to be
 *
 * `docs/18` §5's fraud model rests on phone-OTP as its identity anchor, and
 * YT-0542 records what deferring it costs: with email and password alone a
 * fake account is nearly free. The velocity caps and single-use rules below
 * are therefore written against the **interface** now, so restoring the real
 * anchor later is a driver swap rather than a redesign — which is the
 * difference between a deferral and a hole.
 *
 * ## Single-use is enforced by consumption, not deletion
 *
 * The same rule YT-0540 fixes for `identity.verification_token`: a consumed
 * code stays, marked. Deleting it makes a replay indistinguishable from a
 * code that never existed, and those are different security events — one is
 * an attacker with a real code, the other is an attacker guessing.
 *
 * ## Codes are retrievable, deliberately and loudly
 *
 * `peekCode` exists so development and tests can complete a flow without a
 * phone. It is on the simulated driver only, so there is no way to call it
 * against a real provider — rather than a flag on a shared class that could
 * be set in production. YT-0538 asks for a "deliberate, logged,
 * development-only route", and a method that cannot exist in production is
 * the strongest form of that.
 */

export interface OtpIssued {
  readonly challengeId: string;
  readonly expiresAtMs: number;
}

export type OtpVerdict =
  | { readonly outcome: "verified" }
  | { readonly outcome: "wrong_code"; readonly attemptsRemaining: number }
  | { readonly outcome: "expired" }
  | { readonly outcome: "already_used" }
  | { readonly outcome: "unknown_challenge" };

export interface OtpDriver {
  readonly mode: DriverMode;
  issue(phone: string, nowMs: number): Promise<Result<OtpIssued, BoundaryFailure>>;
  verify(
    challengeId: string,
    code: string,
    nowMs: number,
  ): Promise<Result<OtpVerdict, BoundaryFailure>>;
}

export interface SimulatedOtpDriver extends OtpDriver {
  /** Development-only. See the note above on why it lives here and not on `OtpDriver`. */
  peekCode(challengeId: string): string | undefined;
}

const TTL_MS = 5 * 60 * 1_000;
const MAX_ATTEMPTS = 3;
/** Per phone, per window. A real anchor is worthless if it can be farmed. */
const MAX_ISSUES_PER_WINDOW = 3;
const WINDOW_MS = 15 * 60 * 1_000;

interface Challenge {
  readonly phone: string;
  readonly code: string;
  readonly expiresAtMs: number;
  attemptsUsed: number;
  consumedAtMs: number | undefined;
}

export function createSimulatedOtp(faultPlan?: FaultPlan): SimulatedOtpDriver {
  const engine = new FaultEngine(faultPlan);
  const challenges = new Map<string, Challenge>();
  const issuedAt = new Map<string, number[]>();
  let counter = 0;

  return {
    mode: "simulated",

    issue(phone: string, nowMs: number): Promise<Result<OtpIssued, BoundaryFailure>> {
      const directive = engine.nextCall();
      if (directive !== "proceed") {
        return Promise.resolve(err(failureFor("otp", directive)));
      }

      const recent = (issuedAt.get(phone) ?? []).filter((at) => nowMs - at < WINDOW_MS);
      if (recent.length >= MAX_ISSUES_PER_WINDOW) {
        // A throttle is a real answer from the provider, not an outage —
        // `declined`, so a caller cannot retry its way past it.
        return Promise.resolve(
          err({
            kind: "declined",
            boundary: "otp",
            detail: `Velocity limit: ${String(MAX_ISSUES_PER_WINDOW)} codes per ${String(WINDOW_MS / 60_000)} minutes for one number.`,
            mayHaveSucceeded: false,
          }),
        );
      }

      counter += 1;
      const challengeId = `otp_${String(counter)}`;
      // Deterministic, because a random code makes a test flaky and a flaky
      // test gets retried until it passes.
      const code = String(100_000 + (counter % 900_000));
      challenges.set(challengeId, {
        phone,
        code,
        expiresAtMs: nowMs + TTL_MS,
        attemptsUsed: 0,
        consumedAtMs: undefined,
      });
      issuedAt.set(phone, [...recent, nowMs]);

      return Promise.resolve(ok({ challengeId, expiresAtMs: nowMs + TTL_MS }));
    },

    verify(
      challengeId: string,
      code: string,
      nowMs: number,
    ): Promise<Result<OtpVerdict, BoundaryFailure>> {
      const directive = engine.nextCall();
      if (directive !== "proceed") {
        return Promise.resolve(err(failureFor("otp", directive)));
      }

      const challenge = challenges.get(challengeId);
      if (challenge === undefined) {
        return Promise.resolve(ok({ outcome: "unknown_challenge" }));
      }
      // Consumption is checked BEFORE expiry, so a replayed valid code is
      // reported as a replay rather than aging into "expired" and losing the
      // fact that somebody presented a code that once worked.
      if (challenge.consumedAtMs !== undefined) {
        return Promise.resolve(ok({ outcome: "already_used" }));
      }
      if (nowMs >= challenge.expiresAtMs || challenge.attemptsUsed >= MAX_ATTEMPTS) {
        return Promise.resolve(ok({ outcome: "expired" }));
      }
      if (challenge.code !== code) {
        challenge.attemptsUsed += 1;
        return Promise.resolve(
          ok({ outcome: "wrong_code", attemptsRemaining: MAX_ATTEMPTS - challenge.attemptsUsed }),
        );
      }

      challenge.consumedAtMs = nowMs;
      return Promise.resolve(ok({ outcome: "verified" }));
    },

    peekCode(challengeId: string): string | undefined {
      return challenges.get(challengeId)?.code;
    },
  };
}

export function createOtpDriver(
  mode: DriverMode,
  _env: Environment,
  faultPlan?: FaultPlan,
): OtpDriver {
  return mode === "simulated" ? createSimulatedOtp(faultPlan) : refuseLiveDriver("otp");
}
