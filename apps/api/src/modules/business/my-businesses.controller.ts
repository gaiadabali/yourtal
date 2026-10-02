import { Body, Controller, Get, Inject, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { AsyncPrincipalResolver } from "../../shared/authz/async-principal-resolver";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { AcceptInvitationDto } from "./dto/accept-invitation.schema";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { BUSINESS_ACCOUNT_REPOSITORY } from "./persistence/business-account.repository";
import type { BusinessAccountRepository } from "./persistence/business-account.repository";
import { BUSINESS_MEMBER_REPOSITORY } from "./persistence/business-member.repository";
import type { BusinessMemberRepository } from "./persistence/business-member.repository";
import {
  ACCEPT_TEAM_INVITATION_UNIT_OF_WORK,
  type AcceptTeamInvitationUnitOfWork,
} from "./persistence/accept-team-invitation.unit-of-work";
import { mapBusinessErrorToHttpException } from "./to-http-exception";
import { acceptInvitation } from "./use-cases/accept-invitation.use-case";
import { listMyBusinesses } from "./use-cases/list-my-businesses.use-case";

/**
 * `GET /api/me/businesses` and accepting a team invitation (TASKS.md
 * 7.1.b/7.1.c) — both live at `/api/me/businesses/...` because both are
 * about the CALLER's own relationship to a business, not one already-named
 * tenant, so neither route carries a `:tenantId` (docs/audit/2026-09-25's
 * "no GET /api/businesses or 'my memberships' endpoint" gap).
 */
@Controller("api/me/businesses")
export class MyBusinessesController {
  constructor(
    private readonly principals: AsyncPrincipalResolver,
    @Inject(BUSINESS_ACCOUNT_REPOSITORY) private readonly businesses: BusinessAccountRepository,
    @Inject(BUSINESS_MEMBER_REPOSITORY) private readonly members: BusinessMemberRepository,
    @Inject(ACCEPT_TEAM_INVITATION_UNIT_OF_WORK)
    private readonly acceptUnitOfWork: AcceptTeamInvitationUnitOfWork,
  ) {}

  @Authorize({ kind: "business", action: "list_own" })
  @Get()
  async list(@Req() request: FastifyRequest) {
    const principal = await this.principals.resolve(request);
    const result = await listMyBusinesses(this.businesses, this.members, principal.id);
    if (result.isErr()) {
      throw mapBusinessErrorToHttpException(result.error);
    }
    return result.value;
  }

  @NotValueMoving(
    "Consuming a token is already single-use (the migration's WHERE accepted_at IS NULL) — " +
      "a retried accept just re-reports the same invalid-token outcome, never a second join.",
  )
  @Authorize({ kind: "team_invitation", action: "accept" })
  @Post("invitations/accept")
  async acceptInvitation(@Body() body: AcceptInvitationDto, @Req() request: FastifyRequest) {
    const principal = await this.principals.resolve(request);
    const result = await acceptInvitation(this.acceptUnitOfWork, {
      token: body.token,
      acceptingUserId: principal.id,
      acceptingRegion: principal.attr.jurisdiction,
      now: new Date(),
    });
    if (result.isErr()) {
      throw mapBusinessErrorToHttpException(result.error);
    }
    return result.value;
  }
}
