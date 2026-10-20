import { Inject, Injectable, Logger } from "@nestjs/common";
import type { EmailDriver } from "@yourtal/drivers/email";
import { EMAIL_DRIVER } from "../../shared/drivers/email-driver.module";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import { describeTtl } from "../auth/account-email";
import { hashOpaqueToken } from "./crypto/opaque-token";
import type { InvitationMailer, SendInvitationInput } from "./invitation-mailer";
import { TEAM_INVITATION_TTL_MS } from "./use-cases/invite-member.use-case";

/**
 * The (simulated) send path for a team invitation. Best-effort, same
 * reasoning as `AuthService.deliver`: the invitation row already exists and
 * is acceptable via the token regardless of whether this send succeeds, so
 * a delivery-channel outage should not fail the invite request itself.
 */
@Injectable()
export class EmailInvitationMailer implements InvitationMailer {
  private readonly logger = new Logger(EmailInvitationMailer.name);

  constructor(
    @Inject(EMAIL_DRIVER) private readonly email: EmailDriver,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async send(input: SendInvitationInput): Promise<void> {
    const sent = await this.email.send({
      // The token hash, not the token, as the outbox row's dedupe key —
      // same shape `AuthService.deliver`'s own idempotencyKey uses.
      idempotencyKey: hashOpaqueToken(input.token),
      to: input.to,
      region: input.region,
      category: "team_invitation",
      subject: `Join ${input.businessDisplayName} on YourTal Studio`,
      body: [
        `${input.businessDisplayName} has added you to their team on YourTal Studio as ${input.role}. To accept, sign in to YourTal and open:`,
        "",
        `${this.config.webOrigin}/studio/join?token=${encodeURIComponent(input.token)}`,
        "",
        `The invitation expires in ${describeTtl(TEAM_INVITATION_TTL_MS)}.`,
        "",
        "If you weren't expecting this, you can ignore this email.",
        "",
        "YourTal · yourtal.gaiada.com",
      ].join("\n"),
      metadata: { token: input.token, role: input.role },
    });
    if (sent.isErr()) {
      this.logger.warn(`team invitation email not sent to ${input.to}: ${sent.error.kind}`);
    }
  }
}
