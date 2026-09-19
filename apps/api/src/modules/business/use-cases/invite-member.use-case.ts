import { errAsync } from "neverthrow";
import type { ResultAsync } from "neverthrow";
import type { InviteMemberError } from "../business.errors";
import type { BusinessMember } from "@yourtal/contracts/business/member";
import type {
  AddMemberInput,
  BusinessMemberRepository,
} from "../persistence/business-member.repository";
import type { BusinessAccountRepository } from "../persistence/business-account.repository";
import { wrapPersistence } from "../wrap-persistence";

export function inviteMember(
  businesses: BusinessAccountRepository,
  members: BusinessMemberRepository,
  input: AddMemberInput,
): ResultAsync<BusinessMember, InviteMemberError> {
  return wrapPersistence(businesses.findById(input.businessId)).andThen((business) => {
    if (business === null) {
      return errAsync<BusinessMember, InviteMemberError>({
        type: "business_not_found",
        businessId: input.businessId,
      });
    }
    return wrapPersistence(members.findMember(input.businessId, input.userId)).andThen(
      (existing) => {
        if (existing !== null) {
          return errAsync<BusinessMember, InviteMemberError>({
            type: "member_already_exists",
            userId: input.userId,
          });
        }
        return wrapPersistence(members.addMember(input));
      },
    );
  });
}
