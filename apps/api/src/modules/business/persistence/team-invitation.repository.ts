import type { GrantableRole } from "./business-member.repository";

export interface TeamInvitation {
  readonly id: string;
  readonly businessId: string;
  readonly email: string;
  readonly role: GrantableRole;
  readonly invitedAt: string;
  readonly invitedByUserId: string;
  readonly expiresAt: string;
  readonly acceptedAt: string | null;
}

export interface CreateInvitationInput {
  readonly businessId: string;
  readonly email: string;
  readonly role: GrantableRole;
  readonly invitedByUserId: string;
  /** The token itself is handed to the caller once and never stored — see `crypto/opaque-token.ts`. */
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

export interface TeamInvitationRepository {
  create(input: CreateInvitationInput): Promise<TeamInvitation>;
  /** Neither accepted nor revoked — the state a second invite to the same address must not collide with (migration's partial unique index). */
  findOpenByBusinessAndEmail(businessId: string, email: string): Promise<TeamInvitation | null>;
}

export const TEAM_INVITATION_REPOSITORY = Symbol("TEAM_INVITATION_REPOSITORY");
