import { errAsync } from "neverthrow";
import type { ResultAsync } from "neverthrow";
import type { Business } from "@yourtal/contracts/business";
import { issueOpaqueToken } from "../crypto/opaque-token";
import type { InviteMemberError } from "../business.errors";
import type { GrantableRole } from "../persistence/business-member.repository";
import type { BusinessAccountRepository } from "../persistence/business-account.repository";
import type {
  TeamInvitation,
  TeamInvitationRepository,
} from "../persistence/team-invitation.repository";
import { wrapPersistence } from "../wrap-persistence";

/** TASKS.md 7.1.c: a week to accept, the same order of magnitude as most product invite links. */
const TEAM_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface InviteMemberInput {
  readonly businessId: string;
  readonly email: string;
  readonly role: GrantableRole;
  readonly invitedByUserId: string;
}

export interface InviteMemberResult {
  readonly business: Business;
  readonly invitation: TeamInvitation;
  /** Handed to the caller once, for `TeamInviteController` to mail — never returned in the HTTP response body. */
  readonly token: string;
}

export function inviteMember(
  businesses: BusinessAccountRepository,
  invitations: TeamInvitationRepository,
  input: InviteMemberInput,
): ResultAsync<InviteMemberResult, InviteMemberError> {
  return wrapPersistence(businesses.findById(input.businessId)).andThen((business) => {
    if (business === null) {
      return errAsync<InviteMemberResult, InviteMemberError>({
        type: "business_not_found",
        businessId: input.businessId,
      });
    }
    return wrapPersistence(
      invitations.findOpenByBusinessAndEmail(input.businessId, input.email),
    ).andThen((existing) => {
      if (existing !== null) {
        return errAsync<InviteMemberResult, InviteMemberError>({
          type: "invitation_already_open",
          email: input.email,
        });
      }
      const issued = issueOpaqueToken();
      return wrapPersistence(
        invitations.create({
          businessId: input.businessId,
          email: input.email,
          role: input.role,
          invitedByUserId: input.invitedByUserId,
          tokenHash: issued.hash,
          expiresAt: new Date(Date.now() + TEAM_INVITATION_TTL_MS),
        }),
      ).map((invitation) => ({ business, invitation, token: issued.token }));
    });
  });
}
