import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { EmailDriver } from "@yourtal/drivers/email";
import { APP_CONFIG } from "../../../config/app-config.module";
import type { AppConfig } from "../../../config/app-config";
import { EMAIL_DRIVER } from "../../../shared/drivers/email-driver.module";
import { USER_PROFILE_REPOSITORY } from "../../identity/persistence/user-profile.repository";
import type { UserProfileRepository } from "../../identity/persistence/user-profile.repository";
import {
  CREDENTIAL_REPOSITORY,
  PASSWORD_CREDENTIAL_KIND,
  TOTP_CREDENTIAL_KIND,
} from "../persistence/credential.repository";
import type { CredentialRepository } from "../persistence/credential.repository";
import { PASSKEY_REPOSITORY } from "../persistence/passkey.repository";
import type { PasskeyRepository } from "../persistence/passkey.repository";
import { securityNoticeContent } from "./security-notice-email";
import type { SecurityNotice } from "./security-notice-email";

export const FACTOR_NOTIFIER = Symbol("FACTOR_NOTIFIER");

/** Tells the person when their sign-in methods change. */
export interface FactorNotifications {
  notify(userId: string, notice: SecurityNotice): Promise<void>;
  /** After a password reset: every passkey and app that can still sign them in. */
  afterPasswordReset(userId: string): Promise<void>;
}

/**
 * Emails the account's own address whenever a passkey or an authenticator app
 * is added or removed, so a method planted with a stolen password does not go
 * unnoticed. Best-effort: the change already happened, so a mail outage is
 * logged (never the address) and never undoes or fails it.
 */
@Injectable()
export class EmailFactorNotifier implements FactorNotifications {
  private readonly logger = new Logger("FactorNotifier");

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(EMAIL_DRIVER) private readonly email: EmailDriver,
    @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepository,
    @Inject(PASSKEY_REPOSITORY) private readonly passkeys: PasskeyRepository,
    @Inject(USER_PROFILE_REPOSITORY) private readonly profiles: UserProfileRepository,
  ) {}

  async notify(userId: string, notice: SecurityNotice): Promise<void> {
    try {
      await this.send(userId, notice);
    } catch (cause) {
      this.logger.error(
        `security notice ${notice.kind} not sent: ${cause instanceof Error ? cause.name : "unknown"}`,
      );
    }
  }

  async afterPasswordReset(userId: string): Promise<void> {
    const [passkeys, totp] = await Promise.all([
      this.passkeys.listForUser(userId),
      this.credentials.findByUserAndKind(userId, TOTP_CREDENTIAL_KIND),
    ]);
    const authenticatorOn = totp !== null && totp.verifiedAt !== null;
    if (passkeys.length === 0 && !authenticatorOn) return;
    await this.notify(userId, {
      kind: "password_reset_summary",
      passkeyNames: passkeys.map((passkey) => passkey.name),
      authenticatorOn,
    });
  }

  private async send(userId: string, notice: SecurityNotice): Promise<void> {
    const [password, profile] = await Promise.all([
      this.credentials.findByUserAndKind(userId, PASSWORD_CREDENTIAL_KIND),
      this.profiles.findByUserId(userId),
    ]);
    if (password === null || profile === null) return;
    const { subject, body } = securityNoticeContent(notice, {
      locale: profile.displayLocale === "id-ID" ? "id-ID" : "en-AU",
      displayName: profile.displayName,
      webOrigin: this.config.webOrigin,
    });
    const sent = await this.email.send({
      // Each change is its own message; nothing here is ever resent.
      idempotencyKey: `security_notice:${randomUUID()}`,
      to: password.identifier,
      region: profile.region,
      category: "security_notice",
      subject,
      body,
    });
    if (sent.isErr()) {
      const { kind, mayHaveSucceeded } = sent.error;
      this.logger.error(
        `security notice ${notice.kind} not sent: kind=${kind} mayHaveSucceeded=${String(mayHaveSucceeded)}`,
      );
      return;
    }
    this.logger.log(`security notice ${notice.kind} accepted: id=${sent.value.id}`);
  }
}

/** For unit tests: records what would have been sent. */
export class RecordingFactorNotifier implements FactorNotifications {
  readonly sent: { userId: string; notice: SecurityNotice | "reset_summary" }[] = [];

  notify(userId: string, notice: SecurityNotice): Promise<void> {
    this.sent.push({ userId, notice });
    return Promise.resolve();
  }

  afterPasswordReset(userId: string): Promise<void> {
    this.sent.push({ userId, notice: "reset_summary" });
    return Promise.resolve();
  }
}
