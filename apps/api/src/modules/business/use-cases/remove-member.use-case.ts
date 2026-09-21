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
      // Defense in depth, and NOT redundant with the PDP the way this
      // comment used to claim (YT-0580 correction).
      //
      // `team.yaml`'s `ownership-moves-only-by-transfer` rule covers this
      // action, but `TeamMemberController.remove`'s `attrsFrom` sends only
      // `targetPrincipalId` — never `targetRole` — so `has(R.attr.targetRole)`
      // is always false and the DENY can never fire for `remove_member`
      // (tracked separately as YT-0581; sabotage-proved: an admin removing
      // the real owner gets `EFFECT_ALLOW` from the PDP). This check is
      // consequently the ONLY control on this path today, not a second
      // layer behind one that already works. It reads the real stored role
      // regardless, so a repository that can be called directly (a future
      // job, a script) does not depend on the PDP having been asked at all.
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
