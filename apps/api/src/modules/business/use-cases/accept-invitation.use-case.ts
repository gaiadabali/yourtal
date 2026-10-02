import { errAsync, okAsync } from "neverthrow";
import type { ResultAsync } from "neverthrow";
import type { BusinessMember } from "@yourtal/contracts/business/member";
import type { Region } from "@yourtal/contracts/region";
import { hashOpaqueToken } from "../crypto/opaque-token";
import type { AcceptInvitationError } from "../business.errors";
import type { AcceptTeamInvitationUnitOfWork } from "../persistence/accept-team-invitation.unit-of-work";
import { wrapPersistence } from "../wrap-persistence";

export interface AcceptInvitationInput {
  readonly token: string;
  readonly acceptingUserId: string;
  readonly acceptingRegion: Region;
  readonly now: Date;
}

export interface AcceptInvitationResult {
  readonly businessId: string;
  readonly member: BusinessMember;
}

export function acceptInvitation(
  unitOfWork: AcceptTeamInvitationUnitOfWork,
  input: AcceptInvitationInput,
): ResultAsync<AcceptInvitationResult, AcceptInvitationError> {
  return wrapPersistence(
    unitOfWork.accept({
      tokenHash: hashOpaqueToken(input.token),
      acceptingUserId: input.acceptingUserId,
      acceptingRegion: input.acceptingRegion,
      now: input.now,
    }),
  ).andThen((result) => {
    if (!result.accepted) {
      return errAsync<AcceptInvitationResult, AcceptInvitationError>({
        type: "invitation_invalid",
      });
    }
    return okAsync({ businessId: result.businessId, member: result.member });
  });
}
