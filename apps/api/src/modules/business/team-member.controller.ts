import { Body, Controller, Delete, Inject, Param, Patch } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { PrincipalService } from "../../shared/authz/principal.service";
import { ChangeMemberRoleDto } from "./dto/change-member-role.schema";
import { BUSINESS_ACCOUNT_REPOSITORY } from "./persistence/business-account.repository";
import type { BusinessAccountRepository } from "./persistence/business-account.repository";
import { BUSINESS_MEMBER_REPOSITORY } from "./persistence/business-member.repository";
import type { BusinessMemberRepository } from "./persistence/business-member.repository";
import { mapBusinessErrorToHttpException } from "./to-http-exception";
import { changeMemberRole } from "./use-cases/change-member-role.use-case";
import { removeMember } from "./use-cases/remove-member.use-case";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { Authorize } from "../../shared/authz/authorize.decorator";

@Controller("api/:tenantId/business/team/:userId")
export class TeamMemberController {
  constructor(
    private readonly principals: PrincipalService,
    @Inject(BUSINESS_ACCOUNT_REPOSITORY) private readonly businesses: BusinessAccountRepository,
    @Inject(BUSINESS_MEMBER_REPOSITORY) private readonly members: BusinessMemberRepository,
  ) {}

  @NotValueMoving(
    "Sets a member's role to a named value. Replaying it writes the same role, so a " +
      "retry is a no-op rather than a second change.",
  )
  @Authorize({
    kind: "team",
    action: "change_role",
    // team.yaml refuses any change_role whose target is the owner — the
    // owner moves only through transfer_ownership, which is re-auth gated.
    // The policy can only enforce that if it is told what is being set.
    attrsFrom: (request) => ({
      targetRole: readBodyField(request, "role"),
      targetPrincipalId: readParam(request, "userId"),
    }),
  })
  @Patch("role")
  async changeRole(
    @Param("tenantId") tenantId: string,
    @Param("userId") userId: string,
    @Body() body: ChangeMemberRoleDto,
  ) {
    const result = await changeMemberRole(this.businesses, this.members, {
      businessId: tenantId,
      userId,
      role: body.role,
    });
    if (result.isErr()) {
      throw mapBusinessErrorToHttpException(result.error);
    }
    return result.value;
  }

  @NotValueMoving(
    "Removing a member is already idempotent: the second call finds nobody to remove " +
      "and the end state is identical.",
  )
  @Authorize({
    kind: "team",
    action: "remove_member",
    attrsFrom: (request) => ({ targetPrincipalId: readParam(request, "userId") }),
  })
  @Delete()
  async remove(@Param("tenantId") tenantId: string, @Param("userId") userId: string) {
    const result = await removeMember(this.businesses, this.members, {
      businessId: tenantId,
      userId,
    });
    if (result.isErr()) {
      throw mapBusinessErrorToHttpException(result.error);
    }
    return { removed: true };
  }
}

/**
 * Reads one path parameter, without a cast.
 *
 * `as` needs a justifying comment in this app and there is nothing to
 * justify: a missing parameter should read as absent and let the policy
 * refuse, not be asserted into existence.
 */
function readParam(request: FastifyRequest, name: string): string | undefined {
  const params: unknown = request.params;
  if (typeof params !== "object" || params === null) return undefined;
  const value: unknown = Reflect.get(params, name);
  return typeof value === "string" ? value : undefined;
}

/** Same, for a body field the policy needs to see before the use-case runs. */
function readBodyField(request: FastifyRequest, name: string): string | undefined {
  const body: unknown = request.body;
  if (typeof body !== "object" || body === null) return undefined;
  const value: unknown = Reflect.get(body, name);
  return typeof value === "string" ? value : undefined;
}
