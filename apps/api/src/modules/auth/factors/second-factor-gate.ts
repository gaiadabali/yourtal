import { Inject, Injectable, Logger } from "@nestjs/common";
import { err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import { hashOpaqueToken, issueOpaqueToken } from "../crypto/opaque-token";
import { PASSWORD_AMR, PASSWORD_AND_CODE_AMR } from "../session/amr";
import { SessionIssuer } from "../session/session-issuer";
import { CEREMONY_TTL_SECONDS, PENDING_SIGN_IN_MAX_FAILURES } from "./factor-settings";
import { FACTOR_NOTIFIER } from "./factor-notifier";
import type { FactorNotifications } from "./factor-notifier";
import { FACTOR_STORE } from "./factor-store";
import type { FactorStore } from "./factor-store";
import type { FactorError } from "./factor.errors";
import { TotpService } from "./totp.service";

/** What a correct password leads to. */
export type PasswordSignIn =
  | { readonly kind: "session"; readonly token: string; readonly userId: string }
  | {
      readonly kind: "second_factor";
      readonly pendingToken: string;
      readonly expiresInSeconds: number;
    };

/**
 * The step between a correct password and a session. Without an
 * authenticator app the session is issued at once (`amr` pwd). With one, the
 * caller gets a pending token, stored only as its hash, and the session comes
 * from `completeWithTotp` (`amr` pwd, otp, mfa).
 */
@Injectable()
export class SecondFactorGate {
  private readonly logger = new Logger("SecondFactorGate");

  constructor(
    private readonly totp: TotpService,
    private readonly sessions: SessionIssuer,
    @Inject(FACTOR_STORE) private readonly store: FactorStore,
    @Inject(FACTOR_NOTIFIER) private readonly notifier: FactorNotifications,
  ) {}

  async afterPassword(userId: string, now: Date): Promise<PasswordSignIn> {
    const totpOn = await this.totp.isEnabled(userId);
    if (totpOn && !this.totp.available()) {
      // No seed key on this deployment: the code cannot be checked, and the
      // person must not be locked out of their account because of it.
      this.logger.warn(`authenticator app on for ${userId} but codes are unavailable here`);
    }
    if (!totpOn || !this.totp.available()) {
      const token = await this.sessions.issue(userId, now, PASSWORD_AMR);
      return { kind: "session", token, userId };
    }
    const { token, hash } = issueOpaqueToken();
    await this.store.putPending(hash, { userId, amr: PASSWORD_AMR }, CEREMONY_TTL_SECONDS);
    return { kind: "second_factor", pendingToken: token, expiresInSeconds: CEREMONY_TTL_SECONDS };
  }

  /**
   * A password reset ends every session, then signs in like a password. The
   * person is also told which passkeys and apps can still sign them in, so one
   * planted with a stolen password can be found and removed.
   */
  async afterPasswordReset(userId: string, now: Date): Promise<PasswordSignIn> {
    await this.notifier.afterPasswordReset(userId);
    return this.afterPassword(userId, now);
  }

  async completeWithTotp(
    pendingToken: string,
    code: string,
    now: Date,
  ): Promise<Result<{ token: string; userId: string }, FactorError>> {
    const hash = hashOpaqueToken(pendingToken);
    const pending = await this.store.readPending(hash);
    if (pending === null) return err({ type: "factor_invalid" });

    // Counted before the code is checked, so parallel guesses on one pending
    // sign-in get PENDING_SIGN_IN_MAX_FAILURES tries in all; past that, the
    // password has to be given again.
    const attempt = await this.store.reservePendingAttempt(hash, CEREMONY_TTL_SECONDS);
    if (attempt > PENDING_SIGN_IN_MAX_FAILURES) {
      await this.store.dropPending(hash);
      return err({ type: "factor_invalid" });
    }

    const checked = await this.totp.verify(pending.userId, code, now);
    if (checked.isErr()) {
      if (attempt === PENDING_SIGN_IN_MAX_FAILURES) await this.store.dropPending(hash);
      return err(checked.error);
    }

    await this.store.dropPending(hash);
    const token = await this.sessions.issue(pending.userId, now, PASSWORD_AND_CODE_AMR);
    return ok({ token, userId: pending.userId });
  }
}
