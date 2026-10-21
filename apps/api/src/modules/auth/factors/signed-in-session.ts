import { Inject, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import { presentedSessionToken } from "../bearer-token";
import { hashOpaqueToken } from "../crypto/opaque-token";
import { SessionService } from "../session/session.service";
import { FRESH_SIGN_IN_MS } from "./factor-settings";
import { FACTOR_STORE } from "./factor-store";
import type { FactorStore } from "./factor-store";
import type { FactorError } from "./factor.errors";
import { FactorWindow } from "./factor-window";

/**
 * What a route needs from the caller's session before it touches the
 * account's sign-in methods:
 * - `session`: any live session (reading, confirming an app just enrolled).
 * - `add_factor`: a recent sign-in; and, when the account already has a
 *   passkey or an authenticator app, proof of one of them. Otherwise a
 *   phished password could add the attacker's own passkey and pass every
 *   app's "hwk or mfa" staff rule, and survive a password reset.
 * - `strong`: a recent sign-in with proof of an existing factor (removing a
 *   passkey).
 *
 * Proof of a factor is a session signed in with one (`amr` hwk or mfa), or a
 * step-up on this session in the last few minutes (`POST /api/auth/step-up`),
 * which also counts as a recent sign-in.
 *
 * The first factor on an account can be added with a recent password sign-in
 * alone; that opens the account's factor window (`FactorWindow`).
 */
export type CallerNeed = "session" | "add_factor" | "strong";

export interface Caller {
  readonly userId: string;
  readonly sessionToken: string;
  /**
   * `add_factor` only: the account has no factor yet, so this is its first.
   * Adding it opens the account's factor window.
   */
  readonly firstFactor: boolean;
}

@Injectable()
export class SignedInCaller {
  constructor(
    private readonly sessions: SessionService,
    private readonly window: FactorWindow,
    @Inject(FACTOR_STORE) private readonly store: FactorStore,
  ) {}

  async resolve(
    request: FastifyRequest,
    now: Date,
    need: CallerNeed,
  ): Promise<Result<Caller, FactorError>> {
    const token = presentedSessionToken(request);
    const session = await this.sessions.validateWithSignIn(token, now);
    if (!session.valid) return err({ type: "session_invalid" });
    const caller = { userId: session.userId, sessionToken: token, firstFactor: false };
    if (need === "session") return ok(caller);

    const steppedUp = await this.store.hasStepUp(hashOpaqueToken(token), session.userId);
    const recent = steppedUp || now.getTime() - session.authTime.getTime() <= FRESH_SIGN_IN_MS;
    if (!recent) return err({ type: "reauthentication_required" });

    const proved = steppedUp || session.amr.includes("hwk") || session.amr.includes("mfa");
    if (need === "strong") return proved ? ok(caller) : err({ type: "step_up_required" });
    // An account with no factor gets its first one with whatever session it
    // has (one signed in with a passkey since removed included), and that
    // opens the factor window.
    const hasFactor = await this.window.hasFactor(session.userId);
    if (hasFactor && !proved) return err({ type: "step_up_required" });
    return ok({ ...caller, firstFactor: !hasFactor });
  }
}
