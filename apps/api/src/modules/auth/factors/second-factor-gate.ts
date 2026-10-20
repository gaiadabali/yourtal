import { Inject, Injectable } from "@nestjs/common";
import { err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import { hashOpaqueToken, issueOpaqueToken } from "../crypto/opaque-token";
import { PASSWORD_AMR, PASSWORD_AND_CODE_AMR } from "../session/amr";
import { SessionIssuer } from "../session/session-issuer";
import { CEREMONY_TTL_SECONDS, PENDING_SIGN_IN_MAX_FAILURES } from "./factor-settings";
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
  constructor(
    private readonly totp: TotpService,
    private readonly sessions: SessionIssuer,
    @Inject(FACTOR_STORE) private readonly store: FactorStore,
  ) {}

  async afterPassword(userId: string, now: Date): Promise<PasswordSignIn> {
    if (!(await this.totp.isEnabled(userId))) {
      const token = await this.sessions.issue(userId, now, PASSWORD_AMR);
      return { kind: "session", token, userId };
    }
    const { token, hash } = issueOpaqueToken();
    await this.store.putPending(hash, { userId, amr: PASSWORD_AMR }, CEREMONY_TTL_SECONDS);
    return { kind: "second_factor", pendingToken: token, expiresInSeconds: CEREMONY_TTL_SECONDS };
  }

  async completeWithTotp(
    pendingToken: string,
    code: string,
    now: Date,
  ): Promise<Result<{ token: string; userId: string }, FactorError>> {
    const hash = hashOpaqueToken(pendingToken);
    const pending = await this.store.readPending(hash);
    if (pending === null) return err({ type: "factor_invalid" });

    const checked = await this.totp.verify(pending.userId, code, now);
    if (checked.isErr()) {
      if (checked.error.type === "factor_invalid") {
        const failures = await this.store.countPendingFailure(hash, CEREMONY_TTL_SECONDS);
        // Too many wrong codes: the password has to be given again.
        if (failures >= PENDING_SIGN_IN_MAX_FAILURES) await this.store.dropPending(hash);
      }
      return err(checked.error);
    }

    await this.store.dropPending(hash);
    const token = await this.sessions.issue(pending.userId, now, PASSWORD_AND_CODE_AMR);
    return ok({ token, userId: pending.userId });
  }
}
