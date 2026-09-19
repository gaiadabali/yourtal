import { and, eq } from "drizzle-orm";
import type { BusinessMember } from "@yourtal/contracts/business/member";
import type {
  AddMemberInput,
  BusinessMemberRepository,
  GrantableRole,
} from "./business-member.repository";
import type { BusinessDb } from "./drizzle-client";
import { businessMembers } from "./schema/business-member.table";

/**
 * Verified against a live Postgres — YT-0552. `invite-member`,
 * `change-member-role`, `remove-member` and `list-team` use-case tests each
 * exercise a different method here (`addMember`, `updateRole`,
 * `removeMember`, `listByBusiness`) through `business-db.test-helper.ts`'s
 * real connection, including the unique-index and FK constraints a fake
 * store could not enforce.
 */
export class DrizzleBusinessMemberRepository implements BusinessMemberRepository {
  constructor(private readonly db: BusinessDb) {}

  async addMember(input: AddMemberInput): Promise<BusinessMember> {
    const [row] = await this.db
      .insert(businessMembers)
      .values({
        businessId: input.businessId,
        userId: input.userId,
        role: input.role,
        invitedByUserId: input.invitedByUserId,
      })
      .returning();
    if (row === undefined) {
      throw new Error("insert into business_members returned no row");
    }
    return toDomain(row);
  }

  async findMember(businessId: string, userId: string): Promise<BusinessMember | null> {
    const [row] = await this.db
      .select()
      .from(businessMembers)
      .where(and(eq(businessMembers.businessId, businessId), eq(businessMembers.userId, userId)))
      .limit(1);
    return row === undefined ? null : toDomain(row);
  }

  async listByBusiness(businessId: string): Promise<BusinessMember[]> {
    const rows = await this.db
      .select()
      .from(businessMembers)
      .where(eq(businessMembers.businessId, businessId));
    return rows.map(toDomain);
  }

  async updateRole(
    businessId: string,
    userId: string,
    role: GrantableRole,
  ): Promise<BusinessMember | null> {
    const [row] = await this.db
      .update(businessMembers)
      .set({ role })
      .where(and(eq(businessMembers.businessId, businessId), eq(businessMembers.userId, userId)))
      .returning();
    return row === undefined ? null : toDomain(row);
  }

  async removeMember(businessId: string, userId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(businessMembers)
      .where(and(eq(businessMembers.businessId, businessId), eq(businessMembers.userId, userId)))
      .returning();
    return deleted.length > 0;
  }
}

function toDomain(row: typeof businessMembers.$inferSelect): BusinessMember {
  return {
    businessId: row.businessId,
    userId: row.userId,
    role: row.role,
    invitedAt: row.invitedAt.toISOString(),
    invitedByUserId: row.invitedByUserId,
    joinedAt: row.joinedAt === null ? null : row.joinedAt.toISOString(),
  };
}
