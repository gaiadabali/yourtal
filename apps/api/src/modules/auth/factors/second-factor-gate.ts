import { Inject, Injectable, Logger } from "@nestjs/common";
import { err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import { hashOpaqueToken, issueOpaqueToken } from "../crypto/opaque-token";
import { PASSWORD_AMR, PASSWORD_AND_CODE_AMR } from "../session/amr";
import { SessionIssuer } from "../session/session-issuer";
import { CEREMONY_TTL_SECONDS, PENDING_SIGN_IN_MAX_FAILURES } from "./factor-settings";
import { FactorWindow } from "./factor-window";
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
    private readonly window: FactorWindow,
  ) {}

  async afterPassword(userId: string, now: Date): Promise<PasswordSignIn> {
    const totpOn = await this.totp.isEnabled(userId);
    if (totpOn && !this.totp.available()) {
      // Only reachable in dev: outside it the boot refuses a missing key once
      // any account has an app (TotpService.onApplicationBootstrap).
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
   * A password reset ends every session, then signs in like a password.
   * Inside the account's factor window (72 hours after its first factor was
   * added with a password alone) the reset, which proves the mailbox, first
   * removes every passkey and app and ends every session again, so a factor
   * planted with a phished password, and anything added with it, comes off;
   * the person is told, and signed in with the password alone. Outside it,
   * factors stay and an app's code is asked for. Either way the person is
   * sent the list of what can still sign them in.
   */
  async afterPasswordReset(userId: string, now: Date): Promise<PasswordSignIn> {
    if (await this.window.isOpen(userId, now)) {
      if (await this.window.removeEverything(userId, now)) {
        await this.notifier.notify(userId, { kind: "factors_removed_after_reset" });
      }
    }
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
