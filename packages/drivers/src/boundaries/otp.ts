import { createHash, timingSafeEqual } from "node:crypto";
import { type Result, err, ok } from "neverthrow";
import { type BoundaryFailure, FaultEngine, failureFor } from "../fault-engine";
import type { FaultPlan } from "../faults";
import type { DriverMode, Environment } from "../driver-mode";
import { refuseLiveDriver } from "../live-driver";

/**
 * Phone verification. YT-0538.
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
 * ## The verdict is collapsed at the boundary, on purpose
 *
 * `identity.verification_token` distinguishes `already_consumed`,
 * `not_found` and `expired` internally, then `AuthService` collapses all
 * three into one `token_invalid` before it reaches a caller — so a replay
 * cannot be told apart from a forgery by probing the response. `OtpDriver`
 * IS that boundary here (there is no separate service in front of it yet),
 * so the collapse happens in `verify()` itself: `classify()` below still
 * distinguishes the three reasons, and `debugClassify` exposes that on the
 * simulated driver so a test can assert the distinction is real *before*
 * `verify()` throws it away. `wrong_code` stays distinguishable, because it
 * is not a probe result — a legitimate holder of a device needs to be told
 * they mistyped, with attempts remaining, to complete the flow at all.
 *
 * ## Never store a usable credential at rest
 *
 * The same reason `identity.session` and voucher codes are hashed: a read of
 * the challenge store must not yield a usable code. `Challenge` therefore
 * holds `codeHash`, and `verify()` hashes the submitted code and compares in
 * constant time — never a plaintext `===`. The raw code exists in exactly
 * one place, `devCodes`, which is a distinct store that only the simulated
 * driver has and only `peekCode` reads (see below).
 *
 * ## Two velocity scopes, never combined
 *
 * The same split `apps/api/.../throttle.service.ts` uses for login: one
 * counter protects a single phone number from being farmed
 * (`perPhoneIssuedAt`), a second protects the whole simulated gateway from
 * an attacker who spreads requests across many different numbers so no
 * single number ever trips its own limit (`globalIssuedAt`). A verified
 * phone clears its OWN per-phone record — it has just proven it is not
 * being farmed — but never touches the global one: one legitimate success
 * says nothing about a broad attack running against everyone else.
 *
 * ## Codes are retrievable, deliberately and loudly
 *
 * `peekCode` exists so development and tests can complete a flow without a
 * phone. It reads `devCodes`, a store the credential-comparison path never
 * touches, and every read is appended to `devAccessLog` — a record of
 * *that a code was fetched*, never a record containing the code itself.
 * `peekCode` and `devAccessLog` are on `SimulatedOtpDriver`, not on
 * `OtpDriver`, so there is no way to call either against a real provider —
 * a live driver simply does not have the method, which is a compile-time
 * guarantee rather than a runtime flag someone could leave on in production.
 * Nothing in this module ever calls a logger or `console`: the only two ways
 * a code leaves this file are the `OtpIssued`-shaped SMS a real vendor would
 * send (never returned here — matching production, where the caller does
 * not get the code back either) and this explicit, dev-only method.
 */

export interface OtpIssued {
  readonly challengeId: string;
  readonly expiresAtMs: number;
}

/**
 * The outward verdict. `already_consumed`, `not_found` and `expired` are
 * deliberately NOT distinguished here — see the module doc.
 */
export type OtpVerdict =
  | { readonly outcome: "verified" }
  | { readonly outcome: "wrong_code"; readonly attemptsRemaining: number }
  | { readonly outcome: "refused" };

/**
 * The reason `verify()` is about to collapse to `"refused"`, or `"active"`
 * if the challenge is live. Never part of `OtpDriver` — exists so a test
 * (and `debugClassify`) can observe the distinction the boundary throws
 * away.
 */
export type OtpRefusalReason = "already_consumed" | "not_found" | "expired";

export interface OtpDriver {
  readonly mode: DriverMode;
  issue(phone: string, nowMs: number): Promise<Result<OtpIssued, BoundaryFailure>>;
  verify(
    challengeId: string,
    code: string,
    nowMs: number,
  ): Promise<Result<OtpVerdict, BoundaryFailure>>;
}

/** One record per `peekCode` call. Never carries the code. */
export interface DevOtpAccessRecord {
  readonly challengeId: string;
  readonly atMs: number;
  readonly found: boolean;
}

export interface SimulatedOtpDriver extends OtpDriver {
  /** Development-only. See the module doc for why it lives here and not on `OtpDriver`. */
  peekCode(challengeId: string, nowMs: number): string | undefined;
  /** Audit trail of every `peekCode` call — logged, never the code itself. */
  readonly devAccessLog: readonly DevOtpAccessRecord[];
  /** Test-only: the reason `verify()` would collapse to `"refused"`, without spending an attempt. */
  debugClassify(challengeId: string, nowMs: number): OtpRefusalReason | "active";
}

const TTL_MS = 5 * 60 * 1_000;
const MAX_ATTEMPTS = 3;
/** Per phone, per window. A real anchor is worthless if it can be farmed. */
const MAX_ISSUES_PER_PHONE_WINDOW = 3;
const PHONE_WINDOW_MS = 15 * 60 * 1_000;
/**
 * Across every phone number, per window. Protects the simulated gateway
 * itself from an attacker who never requests more than the per-phone limit
 * for any single number, but drains the account by spreading requests
 * across many.
 */
const MAX_ISSUES_GLOBAL_WINDOW = 20;
const GLOBAL_WINDOW_MS = 15 * 60 * 1_000;

interface Challenge {
  readonly phone: string;
  readonly codeHash: string;
  readonly expiresAtMs: number;
  attemptsUsed: number;
  consumedAtMs: number | undefined;
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** Constant-time. A `===` here would leak how many leading digits a guess got right. */
function codesMatch(submitted: string, storedHash: string): boolean {
  const submittedHash = Buffer.from(hashCode(submitted), "hex");
  const stored = Buffer.from(storedHash, "hex");
  if (submittedHash.length !== stored.length) return false;
  return timingSafeEqual(submittedHash, stored);
}

export function createSimulatedOtp(faultPlan?: FaultPlan): SimulatedOtpDriver {
  const engine = new FaultEngine(faultPlan);
  const challenges = new Map<string, Challenge>();
  /** The one place a raw code lives. Only `peekCode` reads it. */
  const devCodes = new Map<string, string>();
  const devAccessLog: DevOtpAccessRecord[] = [];
  const perPhoneIssuedAt = new Map<string, number[]>();
  let globalIssuedAt: number[] = [];
  let counter = 0;

  /**
   * The internal, undistorted answer. `verify()` collapses everything but
   * `"active"` before it goes anywhere near a caller.
   */
  function classify(challengeId: string, nowMs: number): OtpRefusalReason | "active" {
    const challenge = challenges.get(challengeId);
    if (challenge === undefined) return "not_found";
    // Consumption is checked BEFORE expiry, so a replayed valid code is
    // reported as a replay rather than aging into "expired" and losing the
    // fact that somebody presented a code that once worked.
    if (challenge.consumedAtMs !== undefined) return "already_consumed";
    if (nowMs >= challenge.expiresAtMs || challenge.attemptsUsed >= MAX_ATTEMPTS) return "expired";
    return "active";
  }

  return {
    mode: "simulated",
    devAccessLog,

    issue(phone: string, nowMs: number): Promise<Result<OtpIssued, BoundaryFailure>> {
      const directive = engine.nextCall();
      if (directive !== "proceed") {
        return Promise.resolve(err(failureFor("otp", directive)));
      }

      const recentForPhone = (perPhoneIssuedAt.get(phone) ?? []).filter(
        (at) => nowMs - at < PHONE_WINDOW_MS,
      );
      if (recentForPhone.length >= MAX_ISSUES_PER_PHONE_WINDOW) {
        // A throttle is a real answer from the provider, not an outage —
        // `declined`, so a caller cannot retry its way past it.
        return Promise.resolve(
          err({
            kind: "declined",
            boundary: "otp",
            detail: `Velocity limit: ${String(MAX_ISSUES_PER_PHONE_WINDOW)} codes per ${String(PHONE_WINDOW_MS / 60_000)} minutes for one number.`,
            mayHaveSucceeded: false,
          }),
        );
      }

      const recentGlobal = globalIssuedAt.filter((at) => nowMs - at < GLOBAL_WINDOW_MS);
      if (recentGlobal.length >= MAX_ISSUES_GLOBAL_WINDOW) {
        return Promise.resolve(
          err({
            kind: "declined",
            boundary: "otp",
            detail:
              `Gateway-wide velocity limit: ${String(MAX_ISSUES_GLOBAL_WINDOW)} codes per ` +
              `${String(GLOBAL_WINDOW_MS / 60_000)} minutes across every number. Independent of ` +
              `any single number's limit — protects the account from being drained by an attacker ` +
              `spreading requests across many numbers.`,
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
        codeHash: hashCode(code),
        expiresAtMs: nowMs + TTL_MS,
        attemptsUsed: 0,
        consumedAtMs: undefined,
      });
      devCodes.set(challengeId, code);
      perPhoneIssuedAt.set(phone, [...recentForPhone, nowMs]);
      globalIssuedAt = [...recentGlobal, nowMs];

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

      const state = classify(challengeId, nowMs);
      if (state !== "active") {
        // Collapsed: `already_consumed`, `not_found` and `expired` are
        // indistinguishable from here outward. `classify`/`debugClassify`
        // is where the distinction still lives, for a test to assert.
        return Promise.resolve(ok({ outcome: "refused" }));
      }

      const challenge = challenges.get(challengeId);
      /* v8 ignore next 3 -- `classify` returning "active" guarantees this; kept for the type checker. */
      if (challenge === undefined) {
        return Promise.resolve(ok({ outcome: "refused" }));
      }

      if (!codesMatch(code, challenge.codeHash)) {
        challenge.attemptsUsed += 1;
        return Promise.resolve(
          ok({ outcome: "wrong_code", attemptsRemaining: MAX_ATTEMPTS - challenge.attemptsUsed }),
        );
      }

      challenge.consumedAtMs = nowMs;
      // This phone has just proven it is not being farmed; the GLOBAL
      // counter is untouched, because one legitimate success says nothing
      // about a broad attack spread across every other number.
      perPhoneIssuedAt.delete(challenge.phone);
      return Promise.resolve(ok({ outcome: "verified" }));
    },

    peekCode(challengeId: string, nowMs: number): string | undefined {
      const code = devCodes.get(challengeId);
      devAccessLog.push({ challengeId, atMs: nowMs, found: code !== undefined });
      return code;
    },

    debugClassify(challengeId: string, nowMs: number): OtpRefusalReason | "active" {
      return classify(challengeId, nowMs);
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
