import { Injectable } from "@nestjs/common";

/**
 * The seam `AuthService.deliver()` writes a raw verification token into,
 * instead of any logger. Mirrors the pattern `YT-0538` landed for
 * `SimulatedOtpDriver.peekCode`/`devAccessLog` in
 * `packages/drivers/src/boundaries/otp.ts`: a raw credential lives in
 * exactly one place, a store distinct from anything that gets printed, and
 * every read of it is itself logged — as the FACT that a read happened,
 * never as the value read.
 *
 * ## Why this replaces a `nodeEnv` guard rather than tightening one
 *
 * The line this seam replaces logged the raw token at `debug` level, gated
 * on `nodeEnv !== "production"`. That guard is correct in its own terms and
 * false about the only environment this app actually runs in:
 * `principal.service.ts` refuses to boot when `nodeEnv === "production"`,
 * so a running instance is never in that mode — the "dev-only" branch was
 * the one that always ran, the moment this module shipped. `nodeEnv` cannot
 * do this job, in this deployment, so the fix is not a stricter check on it
 * — it is a different destination for the token, full stop, independent of
 * environment. `record()` below is therefore unconditional: it is not a
 * log write (nothing here calls a logger or `console`), so there is no
 * "level" for an aggregator to ship.
 *
 * ## The compile-time half of the guarantee
 *
 * `AuthService`'s own public methods (`register`, `login`,
 * `requestPasswordReset`, ...) never return or expose a token-bearing
 * value from this class — `deliver()`, the only method that calls
 * `record()`, is private. `peekToken` exists ONLY here, never on
 * `AuthService`: a caller holding only what `AuthController` holds (an
 * `AuthService`) has no member to call that would recover a token. The
 * only way to reach `peekToken` is to hold a direct reference to the SAME
 * `DevTokenAccess` instance `AuthService` was constructed with — which is
 * how the test file uses it, and is not reachable from a route handler.
 */
@Injectable()
export class DevTokenAccess {
  /** The one place a raw token lives. Only `peekToken` reads it. */
  private readonly tokens = new Map<string, string>();
  private readonly log: DevTokenAccessRecord[] = [];

  /** Audit trail of every `peekToken` call — records THAT a token was
   * fetched, never the token itself. */
  get devAccessLog(): readonly DevTokenAccessRecord[] {
    return this.log;
  }

  /**
   * Called by `AuthService.deliver()` on every issuance. Overwrites any
   * previous token for the same `(purpose, userId)` pair — this store
   * tracks "the most recently issued token for this purpose and user", not
   * a history of every one ever issued, which is all a development or test
   * caller needs. Never logs.
   */
  record(purpose: TokenPurpose, userId: string, token: string): void {
    this.tokens.set(key(purpose, userId), token);
  }

  /**
   * Development/test only. Returns the raw token so a test can present the
   * identical value back to the flow it came from (a replay test needs a
   * REAL token, not a fabricated stand-in) — see the module doc for why
   * this is the only place that can happen.
   */
  peekToken(purpose: TokenPurpose, userId: string, nowMs: number): string | undefined {
    const token = this.tokens.get(key(purpose, userId));
    this.log.push({ purpose, userId, atMs: nowMs, found: token !== undefined });
    return token;
  }
}

export type TokenPurpose = "password_reset" | "email_verification";

/** One record per `peekToken` call. Never carries the token. */
export interface DevTokenAccessRecord {
  readonly purpose: TokenPurpose;
  readonly userId: string;
  readonly atMs: number;
  readonly found: boolean;
}

function key(purpose: TokenPurpose, userId: string): string {
  return `${purpose}:${userId}`;
}
