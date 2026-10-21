import { Inject, Injectable } from "@nestjs/common";
import {
  CREDENTIAL_REPOSITORY,
  PASSWORD_CREDENTIAL_KIND,
  TOTP_CREDENTIAL_KIND,
} from "../persistence/credential.repository";
import type { CredentialRepository } from "../persistence/credential.repository";
import { PASSKEY_REPOSITORY } from "../persistence/passkey.repository";
import type { PasskeyRepository } from "../persistence/passkey.repository";

/**
 * The account's factor window. An account's first passkey or authenticator
 * app can be added from a password sign-in alone, so someone holding a
 * phished password can plant one, then add more with it. For 72 hours after
 * that first factor, whoever holds the mailbox can undo all of it: a password
 * reset removes every passkey and app and ends every session. After that,
 * factors protect the account even against a mailbox compromise (docs/26).
 *
 * The window belongs to the account, not to a factor, so nothing added with
 * a planted factor escapes it. It is opened by the repositories, in the
 * transaction that stores a factor, when the account had none (under the
 * account lock, `persistence/factor-lock.ts`). Adding more factors does not
 * extend it; removing factors does not close it (an open window on an
 * account with no factor is harmless), and the next first factor restarts it.
 */
@Injectable()
export class FactorWindow {
  constructor(
    @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepository,
    @Inject(PASSKEY_REPOSITORY) private readonly passkeys: PasskeyRepository,
  ) {}

  async isOpen(userId: string, now: Date): Promise<boolean> {
    const password = await this.credentials.findByUserAndKind(userId, PASSWORD_CREDENTIAL_KIND);
    const until = password?.factorsOpenUntil ?? null;
    return until !== null && until.getTime() > now.getTime();
  }

  /**
   * The mailbox proof (a password reset) inside the window: every passkey and
   * app goes, with every session (a planted passkey's included), in one
   * transaction under the account lock. True when it removed anything.
   */
  async removeEverything(userId: string, now: Date): Promise<boolean> {
    return (await this.credentials.removeAllFactors(userId, now)) > 0;
  }

  async hasFactor(userId: string): Promise<boolean> {
    const [passkeys, totp] = await Promise.all([
      this.passkeys.listForUser(userId),
      this.credentials.findByUserAndKind(userId, TOTP_CREDENTIAL_KIND),
    ]);
    return passkeys.length > 0 || (totp !== null && totp.verifiedAt !== null);
  }
}
