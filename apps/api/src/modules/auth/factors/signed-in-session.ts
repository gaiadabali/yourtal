import { Inject, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import { presentedSessionToken } from "../bearer-token";
import { hashOpaqueToken } from "../crypto/opaque-token";
import { PASSKEY_REPOSITORY } from "../persistence/passkey.repository";
import type { PasskeyRepository } from "../persistence/passkey.repository";
import { SessionService } from "../session/session.service";
import { FRESH_SIGN_IN_MS } from "./factor-settings";
import { FACTOR_STORE } from "./factor-store";
import type { FactorStore } from "./factor-store";
import type { FactorError } from "./factor.errors";
import { TotpService } from "./totp.service";

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
 * One exception to `strong`: a factor bootstrapped (added from a password
 * alone to an account with none) less than 72 hours ago may be removed by a
 * session that a password reset just opened. Otherwise a person whose
 * phished password was used to plant a passkey could never take it off.
 */
export type CallerNeed = "session" | "add_factor" | "strong";

export interface Caller {
  readonly userId: string;
  readonly sessionToken: string;
  /**
   * `add_factor` only: the factor is being added with no proof of another,
   * to an account that has none. It is stored as bootstrapped.
   */
  readonly bootstrapping: boolean;
}

export interface CallerOptions {
  /** `strong` only: the target is a bootstrapped factor still in its 72-hour window. */
  readonly emailProofRemoves?: boolean;
}

@Injectable()
export class SignedInCaller {
  constructor(
    private readonly sessions: SessionService,
    private readonly totp: TotpService,
    @Inject(PASSKEY_REPOSITORY) private readonly passkeys: PasskeyRepository,
    @Inject(FACTOR_STORE) private readonly store: FactorStore,
  ) {}

  async resolve(
    request: FastifyRequest,
    now: Date,
    need: CallerNeed,
    options: CallerOptions = {},
  ): Promise<Result<Caller, FactorError>> {
    const token = presentedSessionToken(request);
    const session = await this.sessions.validateWithSignIn(token, now);
    if (!session.valid) return err({ type: "session_invalid" });
    const caller = { userId: session.userId, sessionToken: token, bootstrapping: false };
    if (need === "session") return ok(caller);

    const sessionHash = hashOpaqueToken(token);
    const steppedUp = await this.store.hasStepUp(sessionHash, session.userId);
    const recent = steppedUp || now.getTime() - session.authTime.getTime() <= FRESH_SIGN_IN_MS;
    if (!recent) return err({ type: "reauthentication_required" });

    const proved = steppedUp || session.amr.includes("hwk") || session.amr.includes("mfa");
    if (proved) return ok(caller);
    if (need === "strong") {
      const emailProven =
        options.emailProofRemoves === true &&
        (await this.store.hasResetProof(sessionHash, session.userId));
      return emailProven ? ok(caller) : err({ type: "step_up_required" });
    }
    if (await this.hasFactor(session.userId)) return err({ type: "step_up_required" });
    return ok({ ...caller, bootstrapping: true });
  }

  private async hasFactor(userId: string): Promise<boolean> {
    const [passkeys, totpOn] = await Promise.all([
      this.passkeys.listForUser(userId),
      this.totp.isEnabled(userId),
    ]);
    return passkeys.length > 0 || totpOn;
  }
}
