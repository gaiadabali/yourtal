import { Body, Controller, Inject, Param, Req, Post } from "@nestjs/common";
import { AsyncPrincipalResolver } from "../../shared/authz/async-principal-resolver";
import { InviteMemberDto } from "./dto/invite-member.schema";
import { BUSINESS_ACCOUNT_REPOSITORY } from "./persistence/business-account.repository";
import type { BusinessAccountRepository } from "./persistence/business-account.repository";
import { BUSINESS_MEMBER_REPOSITORY } from "./persistence/business-member.repository";
import type { BusinessMemberRepository } from "./persistence/business-member.repository";
import { mapBusinessErrorToHttpException } from "./to-http-exception";
import { inviteMember } from "./use-cases/invite-member.use-case";
import { Idempotent } from "../../shared/idempotency/idempotent.decorator";
import { ONBOARDING_RETENTION_MS } from "../../shared/idempotency/retention";
import { Authorize } from "../../shared/authz/authorize.decorator";
import type { FastifyRequest } from "fastify";

@Controller("api/:tenantId/business/team")
export class TeamInviteController {
  constructor(
    private readonly principals: AsyncPrincipalResolver,
    @Inject(BUSINESS_ACCOUNT_REPOSITORY) private readonly businesses: BusinessAccountRepository,
    @Inject(BUSINESS_MEMBER_REPOSITORY) private readonly members: BusinessMemberRepository,
  ) {}

  // A retried invite sends the person a second message and, depending on
  // how the roster settles, can leave two membership rows for one human.
  @Idempotent({ retentionMs: ONBOARDING_RETENTION_MS })
  @Authorize({ kind: "team", action: "invite" })
  @Post("invite")
  async invite(
    @Param("tenantId") tenantId: string,
    @Body() body: InviteMemberDto,
    @Req() request: FastifyRequest,
  ) {
    const principal = await this.principals.resolve(request);

    const result = await inviteMember(this.businesses, this.members, {
      businessId: tenantId,
      userId: body.userId,
      role: body.role,
      invitedByUserId: principal.id,
    });
    if (result.isErr()) {
      throw mapBusinessErrorToHttpException(result.error);
    }
    return result.value;
  }
}
