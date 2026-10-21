import { Inject, Injectable } from "@nestjs/common";
import {
  CREDENTIAL_REPOSITORY,
  PASSWORD_CREDENTIAL_KIND,
  TOTP_CREDENTIAL_KIND,
} from "../persistence/credential.repository";
import type { CredentialRepository } from "../persistence/credential.repository";
import { PASSKEY_REPOSITORY } from "../persistence/passkey.repository";
import type { PasskeyRepository } from "../persistence/passkey.repository";
import { SessionService } from "../session/session.service";
import { FACTOR_WINDOW_MS } from "./factor-settings";

/**
 * The account's factor window. An account's first passkey or authenticator
 * app can be added from a password sign-in alone, so someone holding a
 * phished password can plant one, then add more with it. For 72 hours after
 * that first factor, whoever holds the mailbox can undo all of it: a password
 * reset removes every passkey and app and ends every session. After that,
 * factors protect the account even against a mailbox compromise (docs/26).
 *
 * The window belongs to the account, not to a factor, so nothing added with
 * a planted factor escapes it. Adding more factors does not extend it; an
 * account left with no factor closes it, and its next first factor opens a
 * new one.
 */
@Injectable()
export class FactorWindow {
  constructor(
    @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepository,
    @Inject(PASSKEY_REPOSITORY) private readonly passkeys: PasskeyRepository,
    private readonly sessions: SessionService,
  ) {}

  /** Called when an account with no factor gets its first from a password-only session. */
  async openForFirstFactor(userId: string, now: Date): Promise<void> {
    await this.credentials.setFactorsOpenUntil(userId, new Date(now.getTime() + FACTOR_WINDOW_MS));
  }

  async isOpen(userId: string, now: Date): Promise<boolean> {
    const password = await this.credentials.findByUserAndKind(userId, PASSWORD_CREDENTIAL_KIND);
    const until = password?.factorsOpenUntil ?? null;
    return until !== null && until.getTime() > now.getTime();
  }

  /** After a removal: an account with no passkey and no app has no window either. */
  async closeIfNoFactors(userId: string): Promise<void> {
    if (!(await this.hasFactor(userId))) await this.credentials.setFactorsOpenUntil(userId, null);
  }

  /**
   * The mailbox proof (a password reset) inside the window: every passkey and
   * app goes, with every session (a planted passkey's included). True when it
   * removed anything.
   */
  async removeEverything(userId: string, now: Date): Promise<boolean> {
    const removed = await this.credentials.removeAllFactors(userId);
    await this.sessions.revokeAllForUser(userId, now);
    return removed > 0;
  }

  async hasFactor(userId: string): Promise<boolean> {
    const [passkeys, totp] = await Promise.all([
      this.passkeys.listForUser(userId),
      this.credentials.findByUserAndKind(userId, TOTP_CREDENTIAL_KIND),
    ]);
    return passkeys.length > 0 || (totp !== null && totp.verifiedAt !== null);
  }
}
