import { errAsync, okAsync } from "neverthrow";
import type { ResultAsync } from "neverthrow";
import type { ChangeMemberRoleError } from "../business.errors";
import type { BusinessMember } from "@yourtal/contracts/business/member";
import type { BusinessAccountRepository } from "../persistence/business-account.repository";
import type {
  BusinessMemberRepository,
  GrantableRole,
} from "../persistence/business-member.repository";
import { wrapPersistence } from "../wrap-persistence";

export interface ChangeMemberRoleInput {
  readonly businessId: string;
  readonly userId: string;
  readonly role: GrantableRole;
}

export function changeMemberRole(
  businesses: BusinessAccountRepository,
  members: BusinessMemberRepository,
  input: ChangeMemberRoleInput,
): ResultAsync<BusinessMember, ChangeMemberRoleError> {
  return wrapPersistence(businesses.findById(input.businessId)).andThen((business) => {
    if (business === null) {
      return errAsync<BusinessMember, ChangeMemberRoleError>({
        type: "business_not_found",
        businessId: input.businessId,
      });
    }
    return wrapPersistence(members.findMember(input.businessId, input.userId)).andThen((member) => {
      if (member === null) {
        return errAsync<BusinessMember, ChangeMemberRoleError>({
          type: "member_not_found",
          userId: input.userId,
        });
      }
      // Defense in depth, mirroring `remove-member.use-case.ts`: the owner
      // role moves only through `transfer_ownership`, never `change_role`
      // (docs/17 section 2.1). `team.yaml`'s `ownership-moves-only-by-
      // transfer` rule enforces this too, but only when the caller has
      // asked the PDP with the target's real STORED role as `targetRole`
      // — `TeamMemberController.changeRole` does a second, post-read
      // authorization call for exactly that reason (YT-0580), because
      // `attrsFrom` runs synchronously against the request alone and
      // cannot read the database. A repository that can be called
      // directly (a future job, a script) should not rely on the caller
      // having done that.
      if (member.role === "owner") {
        return errAsync<BusinessMember, ChangeMemberRoleError>({
          type: "cannot_change_owner_role",
        });
      }
      return wrapPersistence(
        members.updateRole(input.businessId, input.userId, input.role),
      ).andThen((updated) =>
        updated === null
          ? errAsync<BusinessMember, ChangeMemberRoleError>({
              type: "member_not_found",
              userId: input.userId,
            })
          : okAsync<BusinessMember, ChangeMemberRoleError>(updated),
      );
    });
  });
}
