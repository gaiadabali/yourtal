import { Inject, Injectable, Logger } from "@nestjs/common";
import type { EmailDriver } from "@yourtal/drivers/email";
import { EMAIL_DRIVER } from "../../shared/drivers/email-driver.module";
import { hashOpaqueToken } from "./crypto/opaque-token";
import type { InvitationMailer, SendInvitationInput } from "./invitation-mailer";

/**
 * The (simulated) send path for a team invitation. Best-effort, same
 * reasoning as `AuthService.deliver`: the invitation row already exists and
 * is acceptable via the token regardless of whether this send succeeds, so
 * a delivery-channel outage should not fail the invite request itself.
 */
@Injectable()
export class EmailInvitationMailer implements InvitationMailer {
  private readonly logger = new Logger(EmailInvitationMailer.name);

  constructor(@Inject(EMAIL_DRIVER) private readonly email: EmailDriver) {}

  async send(input: SendInvitationInput): Promise<void> {
    const sent = await this.email.send({
      // The token hash, not the token, as the outbox row's dedupe key —
      // same shape `AuthService.deliver`'s own idempotencyKey uses.
      idempotencyKey: hashOpaqueToken(input.token),
      to: input.to,
      region: input.region,
      category: "team_invitation",
      subject: `You're invited to join ${input.businessDisplayName} on YourTal Studio`,
      body:
        `You've been invited to join ${input.businessDisplayName} as ${input.role}. ` +
        `Use this token in the app to accept: ${input.token}`,
      metadata: { token: input.token, role: input.role },
    });
    if (sent.isErr()) {
      this.logger.warn(`team invitation email not sent to ${input.to}: ${sent.error.kind}`);
    }
  }
}
