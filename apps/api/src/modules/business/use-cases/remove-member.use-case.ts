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
      // Defense in depth, mirroring `change-member-role.use-case.ts`: the
      // owner role moves only through `transfer_ownership`, never
      // `remove_member` (docs/17 section 2.1). `team.yaml`'s `ownership-
      // moves-only-by-transfer` rule enforces this too, now that
      // `TeamMemberController.remove` makes a second, post-read
      // authorization call supplying the target's real STORED role as
      // `targetRole` (YT-0581, sibling fix to YT-0580) — before that fix,
      // `attrsFrom` sent only `targetPrincipalId` and the DENY could never
      // fire for this action. This check does not depend on that call
      // having been made: a repository reachable directly (a future job,
      // a script) should not rely on the caller having asked the PDP at
      // all, so it reads the real stored role itself regardless.
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
