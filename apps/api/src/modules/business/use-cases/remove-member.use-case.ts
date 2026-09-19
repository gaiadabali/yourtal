import { errAsync, okAsync } from "neverthrow";
import type { ResultAsync } from "neverthrow";
import type { RemoveMemberError } from "../business.errors";
import type { BusinessAccountRepository } from "../persistence/business-account.repository";
import type { BusinessMemberRepository } from "../persistence/business-member.repository";
import { wrapPersistence } from "../wrap-persistence";

export interface RemoveMemberInput {
  readonly businessId: string;
  readonly userId: string;
}

export function removeMember(
  businesses: BusinessAccountRepository,
  members: BusinessMemberRepository,
  input: RemoveMemberInput,
): ResultAsync<void, RemoveMemberError> {
  const result: ResultAsync<void, RemoveMemberError> = wrapPersistence(
    businesses.findById(input.businessId),
  ).andThen((business) => {
    if (business === null) {
      return errAsync({ type: "business_not_found" as const, businessId: input.businessId });
    }
    return wrapPersistence(members.findMember(input.businessId, input.userId)).andThen((member) => {
      if (member === null) {
        return errAsync({ type: "member_not_found" as const, userId: input.userId });
      }
      // Defense in depth: `team.yaml`'s `ownership-moves-only-by-transfer`
      // rule already denies this at the PDP, but a repository that can be
      // called directly (a future job, a script) should not rely on the
      // caller having asked Cerbos first.
      if (member.role === "owner") {
        return errAsync({ type: "cannot_remove_owner" as const });
      }
      return wrapPersistence(members.removeMember(input.businessId, input.userId)).andThen(
        (removed) =>
          removed
            ? okAsync(undefined)
            : errAsync({ type: "member_not_found" as const, userId: input.userId }),
      );
    });
  });
  return result;
}
