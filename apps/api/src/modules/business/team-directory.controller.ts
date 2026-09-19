import { Controller, Get, Inject, Param } from "@nestjs/common";
import { PrincipalService } from "../../shared/authz/principal.service";
import { BUSINESS_ACCOUNT_REPOSITORY } from "./persistence/business-account.repository";
import type { BusinessAccountRepository } from "./persistence/business-account.repository";
import { BUSINESS_MEMBER_REPOSITORY } from "./persistence/business-member.repository";
import type { BusinessMemberRepository } from "./persistence/business-member.repository";
import { mapBusinessErrorToHttpException } from "./to-http-exception";
import { listTeam } from "./use-cases/list-team.use-case";
import { Authorize } from "../../shared/authz/authorize.decorator";

@Controller("api/:tenantId/business/team")
export class TeamDirectoryController {
  constructor(
    private readonly principals: PrincipalService,
    @Inject(BUSINESS_ACCOUNT_REPOSITORY) private readonly businesses: BusinessAccountRepository,
    @Inject(BUSINESS_MEMBER_REPOSITORY) private readonly members: BusinessMemberRepository,
  ) {}

  @Authorize({ kind: "team", action: "view" })
  @Get()
  async list(@Param("tenantId") tenantId: string) {
    const result = await listTeam(this.businesses, this.members, tenantId);
    if (result.isErr()) {
      throw mapBusinessErrorToHttpException(result.error);
    }
    return result.value;
  }
}
