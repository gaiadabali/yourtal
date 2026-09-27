import { and, eq, gt, isNull } from "drizzle-orm";
import type {
  AcceptInvitationInput,
  AcceptInvitationResult,
  AcceptTeamInvitationUnitOfWork,
} from "./accept-team-invitation.unit-of-work";
import type { BusinessDb } from "./drizzle-client";
import { businessMembers } from "./schema/business-member.table";
import { teamInvitations } from "./schema/team-invitation.table";

/**
 * Verified against a live Postgres (YT-0552 discipline). The consume step
 * (the `UPDATE ... WHERE accepted_at IS NULL AND revoked_at IS NULL AND
 * expires_at > now()`) is one atomic statement, not a read then a write —
 * the same reason `VerificationTokenRepository.consume` has no separate
 * `get`: two concurrent presentations of one token must not both observe
 * "not yet consumed".
 */
export class DrizzleAcceptTeamInvitationUnitOfWork implements AcceptTeamInvitationUnitOfWork {
  constructor(private readonly db: BusinessDb) {}

  async accept(input: AcceptInvitationInput): Promise<AcceptInvitationResult> {
    return this.db.transaction(async (tx) => {
      const [invitation] = await tx
        .update(teamInvitations)
        .set({ acceptedAt: input.now, acceptedByUserId: input.acceptingUserId })
        .where(
          and(
            eq(teamInvitations.tokenHash, input.tokenHash),
            isNull(teamInvitations.acceptedAt),
            isNull(teamInvitations.revokedAt),
            gt(teamInvitations.expiresAt, input.now),
          ),
        )
        .returning();
      if (invitation === undefined) {
        return { accepted: false };
      }

      // `ON CONFLICT` rather than a plain INSERT: a person invited twice
      // across two accepted tokens, or re-accepting after a role change,
      // still ends with exactly one membership row per (business, user) —
      // the same unique index `business_members_business_id_user_id_key`
      // already enforces.
      const [member] = await tx
        .insert(businessMembers)
        .values({
          businessId: invitation.businessId,
          userId: input.acceptingUserId,
          role: invitation.role,
          invitedByUserId: invitation.invitedByUserId,
          joinedAt: input.now,
        })
        .onConflictDoUpdate({
          target: [businessMembers.businessId, businessMembers.userId],
          set: { role: invitation.role, joinedAt: input.now },
        })
        .returning();
      if (member === undefined) {
        throw new Error("insert into business_members returned no row");
      }

      return {
        accepted: true,
        businessId: invitation.businessId,
        member: {
          businessId: member.businessId,
          userId: member.userId,
          role: member.role,
          invitedAt: member.invitedAt.toISOString(),
          invitedByUserId: member.invitedByUserId,
          joinedAt: member.joinedAt === null ? null : member.joinedAt.toISOString(),
        },
      };
    });
  }
}
