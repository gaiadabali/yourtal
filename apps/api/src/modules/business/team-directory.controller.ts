import { Controller, Get, Inject, Param } from "@nestjs/common";
import { ACCOUNT_EMAIL_READER } from "../identity/persistence/account-email-reader";
import type { AccountEmailReader } from "../identity/persistence/account-email-reader";
import { USER_PROFILE_REPOSITORY } from "../identity/persistence/user-profile.repository";
import type { UserProfileRepository } from "../identity/persistence/user-profile.repository";
import { PrincipalService } from "../../shared/authz/principal.service";
import { BUSINESS_ACCOUNT_REPOSITORY } from "./persistence/business-account.repository";
import type { BusinessAccountRepository } from "./persistence/business-account.repository";
import { BUSINESS_MEMBER_REPOSITORY } from "./persistence/business-member.repository";
import type { BusinessMemberRepository } from "./persistence/business-member.repository";
import { mapBusinessErrorToHttpException } from "./to-http-exception";
import { listTeam } from "./use-cases/list-team.use-case";
import { withMemberProfiles } from "./use-cases/with-member-profiles";
import { Authorize } from "../../shared/authz/authorize.decorator";

@Controller("api/:tenantId/business/team")
export class TeamDirectoryController {
  constructor(
    private readonly principals: PrincipalService,
    @Inject(BUSINESS_ACCOUNT_REPOSITORY) private readonly businesses: BusinessAccountRepository,
    @Inject(BUSINESS_MEMBER_REPOSITORY) private readonly members: BusinessMemberRepository,
    @Inject(USER_PROFILE_REPOSITORY) private readonly profiles: UserProfileRepository,
    @Inject(ACCOUNT_EMAIL_READER) private readonly emails: AccountEmailReader,
  ) {}

  @Authorize({ kind: "team", action: "view" })
  @Get()
  async list(@Param("tenantId") tenantId: string) {
    const result = await listTeam(this.businesses, this.members, tenantId);
    if (result.isErr()) {
      throw mapBusinessErrorToHttpException(result.error);
    }
    return withMemberProfiles(result.value, this.profiles, this.emails);
  }
}
