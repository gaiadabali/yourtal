import { Body, Controller, Delete, Inject, Param, Patch, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { PdpClient } from "@yourtal/authz/pdp-client";
import { AsyncPrincipalResolver } from "../../shared/authz/async-principal-resolver";
import { mapAuthzErrorToHttpException } from "../../shared/authz/authz-error.mapper";
import { PDP_CLIENT } from "../../shared/pdp/pdp-client.module";
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
    private readonly principals: AsyncPrincipalResolver,
    @Inject(PDP_CLIENT) private readonly pdp: PdpClient,
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
    // This first check only proves the caller may change SOME member's
    // role, and — as a bonus, redundant with the DTO's `.exclude(["owner"])`
    // — that they are not trying to GRANT owner via this route. It cannot
    // refuse DEMOTING the owner, because that needs the target's real
    // STORED role and `attrsFrom` runs synchronously against the request
    // alone; the role below is only what the caller is asking to set it to.
    // See the second, post-read `requireAction` call in `changeRole` for
    // that half (YT-0580).
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
    @Req() request: FastifyRequest,
  ) {
    const principal = await this.principals.resolve(request);

    const currentMember = await this.members.findMember(tenantId, userId);
    if (currentMember !== null) {
      // The `@Authorize` above cannot see whether the TARGET is the owner
      // (see the comment there). Now that the member has been read, ask
      // the PDP again with the fact that matters: the target's real STORED
      // role, not the role the caller is requesting. Mirrors
      // `StoreListingController.setSettlementValue`'s second, post-read
      // authorization call for `set_settlement_value`. `team.yaml`'s
      // `ownership-moves-only-by-transfer` rule denies `change_role`
      // whenever `targetRole == "owner"` — this is what lets that
      // condition see the truth instead of a client-supplied value.
      const authz = await this.pdp.requireAction(
        principal,
        {
          kind: "team",
          id: userId,
          attr: {
            businessId: tenantId,
            targetRole: currentMember.role,
            targetPrincipalId: userId,
          },
        },
        "change_role",
      );
      if (authz.isErr()) throw mapAuthzErrorToHttpException(authz.error);
    }

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
    // This check only proves the caller may remove SOME member of this
    // business; it cannot see whether the TARGET is the owner, because
    // `attrsFrom` runs synchronously against the request alone and there is
    // no request-supplied role to read for a removal (unlike `change_role`,
    // there is nothing here to distinguish from a legitimate case by
    // rejecting it up front). See the second, post-read `requireAction`
    // call below for that half (YT-0581, sibling of YT-0580).
    attrsFrom: (request) => ({ targetPrincipalId: readParam(request, "userId") }),
  })
  @Delete()
  async remove(
    @Param("tenantId") tenantId: string,
    @Param("userId") userId: string,
    @Req() request: FastifyRequest,
  ) {
    const currentMember = await this.members.findMember(tenantId, userId);
    if (currentMember !== null) {
      // The `@Authorize` above cannot see whether the TARGET is the owner
      // (see the comment there). Now that the member has been read, ask
      // the PDP again with the fact that matters: the target's real STORED
      // role. Mirrors `TeamMemberController.changeRole`'s second, post-read
      // authorization call (YT-0580) and `StoreListingController
      // .setSettlementValue`'s for `set_settlement_value`. `team.yaml`'s
      // `ownership-moves-only-by-transfer` rule denies `remove_member`
      // whenever `targetRole == "owner"` — this is what lets that
      // condition see the truth, where before this fix `attrsFrom` sent no
      // `targetRole` at all and the rule could never fire for this action.
      const principal = await this.principals.resolve(request);
      const authz = await this.pdp.requireAction(
        principal,
        {
          kind: "team",
          id: userId,
          attr: {
            businessId: tenantId,
            targetRole: currentMember.role,
            targetPrincipalId: userId,
          },
        },
        "remove_member",
      );
      if (authz.isErr()) throw mapAuthzErrorToHttpException(authz.error);
    }

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
