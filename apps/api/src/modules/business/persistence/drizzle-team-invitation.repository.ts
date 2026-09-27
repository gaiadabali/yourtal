import { and, eq, isNull } from "drizzle-orm";
import type {
  CreateInvitationInput,
  TeamInvitation,
  TeamInvitationRepository,
} from "./team-invitation.repository";
import type { BusinessDb } from "./drizzle-client";
import { teamInvitations } from "./schema/team-invitation.table";

/** Verified against a live Postgres, same discipline as every other repository in this module (YT-0552). */
export class DrizzleTeamInvitationRepository implements TeamInvitationRepository {
  constructor(private readonly db: BusinessDb) {}

  async create(input: CreateInvitationInput): Promise<TeamInvitation> {
    const [row] = await this.db
      .insert(teamInvitations)
      .values({
        businessId: input.businessId,
        email: input.email,
        role: input.role,
        tokenHash: input.tokenHash,
        invitedByUserId: input.invitedByUserId,
        expiresAt: input.expiresAt,
      })
      .returning();
    if (row === undefined) {
      throw new Error("insert into team_invitations returned no row");
    }
    return toDomain(row);
  }

  async findOpenByBusinessAndEmail(
    businessId: string,
    email: string,
  ): Promise<TeamInvitation | null> {
    const [row] = await this.db
      .select()
      .from(teamInvitations)
      .where(
        and(
          eq(teamInvitations.businessId, businessId),
          // Case-insensitive, matching the migration's `lower(email)` unique index.
          eq(teamInvitations.email, email.toLowerCase()),
          isNull(teamInvitations.acceptedAt),
          isNull(teamInvitations.revokedAt),
        ),
      )
      .limit(1);
    return row === undefined ? null : toDomain(row);
  }
}

function toDomain(row: typeof teamInvitations.$inferSelect): TeamInvitation {
  return {
    id: row.id,
    businessId: row.businessId,
    email: row.email,
    role: row.role,
    invitedAt: row.invitedAt.toISOString(),
    invitedByUserId: row.invitedByUserId,
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt === null ? null : row.acceptedAt.toISOString(),
  };
}
