/**
 * TASKS.md 7.1.c: the business module's own port for sending a team
 * invitation email — bound to 1.6's simulated `EmailDriver`, never a new
 * driver in `packages/drivers` (this ticket's own instruction). Named
 * separately from `EmailDriver` itself so this module depends on a
 * business-shaped interface, not the driver's wire format, matching
 * `AuthService`'s own `deliver` private method for password-reset/
 * email-verification -- the difference here is this port is a first-class
 * injectable so `team-invite.controller.ts` need not know the driver exists.
 */
export interface SendInvitationInput {
  readonly to: string;
  readonly region: "AU" | "ID";
  readonly businessDisplayName: string;
  readonly role: string;
  /** The raw token — never the hash — reaches the invitee this one way. */
  readonly token: string;
}

export interface InvitationMailer {
  send(input: SendInvitationInput): Promise<void>;
}

export const INVITATION_MAILER = Symbol("INVITATION_MAILER");
