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
    return wrapPersistence(members.updateRole(input.businessId, input.userId, input.role)).andThen(
      (updated) =>
        updated === null
          ? errAsync<BusinessMember, ChangeMemberRoleError>({
              type: "member_not_found",
              userId: input.userId,
            })
          : okAsync<BusinessMember, ChangeMemberRoleError>(updated),
    );
  });
}
