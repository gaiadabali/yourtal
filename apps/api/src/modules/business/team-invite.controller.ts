import { Body, Controller, Inject, Param, Req, Post } from "@nestjs/common";
import { AsyncPrincipalResolver } from "../../shared/authz/async-principal-resolver";
import { InviteMemberDto } from "./dto/invite-member.schema";
import { BUSINESS_ACCOUNT_REPOSITORY } from "./persistence/business-account.repository";
import type { BusinessAccountRepository } from "./persistence/business-account.repository";
import { TEAM_INVITATION_REPOSITORY } from "./persistence/team-invitation.repository";
import type { TeamInvitationRepository } from "./persistence/team-invitation.repository";
import { INVITATION_MAILER } from "./invitation-mailer";
import type { InvitationMailer } from "./invitation-mailer";
import { mapBusinessErrorToHttpException } from "./to-http-exception";
import { inviteMember } from "./use-cases/invite-member.use-case";
import { Idempotent } from "../../shared/idempotency/idempotent.decorator";
import { ONBOARDING_RETENTION_MS } from "../../shared/idempotency/retention";
import { Authorize } from "../../shared/authz/authorize.decorator";
import type { FastifyRequest } from "fastify";

/**
 * TASKS.md 7.1.c: invites by email, not the raw `userId` the old version
 * took (docs/audit/2026-09-25/business-merchant.md). The invitee need not
 * have an account yet — the token is what carries the invite, and
 * `MyBusinessesController.acceptInvitation` is where it is redeemed.
 */
@Controller("api/:tenantId/business/team")
export class TeamInviteController {
  constructor(
    private readonly principals: AsyncPrincipalResolver,
    @Inject(BUSINESS_ACCOUNT_REPOSITORY) private readonly businesses: BusinessAccountRepository,
    @Inject(TEAM_INVITATION_REPOSITORY) private readonly invitations: TeamInvitationRepository,
    @Inject(INVITATION_MAILER) private readonly mailer: InvitationMailer,
  ) {}

  // A retry sends the person a second email but never a second open
  // invitation for the same address — the migration's partial unique index
  // refuses that at the database, and `invite-member.use-case.ts` maps it
  // to `invitation_already_open` rather than minting a fresh token.
  @Idempotent({ retentionMs: ONBOARDING_RETENTION_MS })
  @Authorize({ kind: "team", action: "invite" })
  @Post("invite")
  async invite(
    @Param("tenantId") tenantId: string,
    @Body() body: InviteMemberDto,
    @Req() request: FastifyRequest,
  ) {
    const principal = await this.principals.resolve(request);

    const result = await inviteMember(this.businesses, this.invitations, {
      businessId: tenantId,
      email: body.email,
      role: body.role,
      invitedByUserId: principal.id,
    });
    if (result.isErr()) {
      throw mapBusinessErrorToHttpException(result.error);
    }

    const { business, invitation, token } = result.value;
    await this.mailer.send({
      to: invitation.email,
      region: business.region,
      businessDisplayName: business.displayName,
      role: invitation.role,
      token,
    });

    // The token never appears in the response — it already left, once, by email.
    return {
      id: invitation.id,
      businessId: invitation.businessId,
      email: invitation.email,
      role: invitation.role,
      invitedAt: invitation.invitedAt,
      expiresAt: invitation.expiresAt,
    };
  }
}
