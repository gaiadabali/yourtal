import type { BusinessMember } from "@yourtal/contracts/business/member";

export interface AcceptInvitationInput {
  readonly tokenHash: string;
  readonly acceptingUserId: string;
  readonly now: Date;
}

export type AcceptInvitationResult =
  | { readonly accepted: true; readonly businessId: string; readonly member: BusinessMember }
  /** Not found, already accepted/revoked, or expired — collapsed the same way `VerificationTokenRepository`'s ConsumeRefusal is at the HTTP boundary (YT-0153 enumeration discipline). */
  | { readonly accepted: false };

/**
 * Consuming an invitation and joining the business is one atomic step —
 * the same "exist together or not at all" reasoning
 * `BusinessOnboardingUnitOfWork` documents for a business and its founding
 * owner. A concurrent double-accept of the same token must not produce two
 * membership rows or one row with two different roles.
 */
export interface AcceptTeamInvitationUnitOfWork {
  accept(input: AcceptInvitationInput): Promise<AcceptInvitationResult>;
}

export const ACCEPT_TEAM_INVITATION_UNIT_OF_WORK = Symbol("ACCEPT_TEAM_INVITATION_UNIT_OF_WORK");
