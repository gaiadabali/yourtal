import { and, eq } from "drizzle-orm";
import type {
  TransferOwnershipUnitOfWork,
  TransferOwnershipWrite,
  TransferOwnershipWriteResult,
} from "./transfer-ownership.unit-of-work";
import type { BusinessDb } from "./drizzle-client";
import { businessMembers } from "./schema/business-member.table";

/** Verified against a live Postgres (YT-0552 discipline). */
export class DrizzleTransferOwnershipUnitOfWork implements TransferOwnershipUnitOfWork {
  constructor(private readonly db: BusinessDb) {}

  async transfer(input: TransferOwnershipWrite): Promise<TransferOwnershipWriteResult> {
    return this.db.transaction(async (tx) => {
      // Locked and existence-checked BEFORE the demote write below, so a
      // missing new owner is discovered while nothing has been written yet
      // — the demote/promote order below only stays safe if the promote
      // step cannot fail for a reason this check would have caught.
      const [newOwnerRow] = await tx
        .select()
        .from(businessMembers)
        .where(
          and(
            eq(businessMembers.businessId, input.businessId),
            eq(businessMembers.userId, input.newOwnerUserId),
          ),
        )
        .for("update");
      if (newOwnerRow === undefined) {
        return { ok: false, reason: "new_owner_not_member" };
      }

      const [demoted] = await tx
        .update(businessMembers)
        .set({ role: "admin" })
        .where(
          and(
            eq(businessMembers.businessId, input.businessId),
            eq(businessMembers.userId, input.currentOwnerUserId),
          ),
        )
        .returning();
      if (demoted === undefined) {
        // Nothing written yet (the SELECT above took no lock worth undoing) — safe to return.
        return { ok: false, reason: "current_owner_not_member" };
      }

      const [promoted] = await tx
        .update(businessMembers)
        .set({ role: "owner" })
        .where(
          and(
            eq(businessMembers.businessId, input.businessId),
            eq(businessMembers.userId, input.newOwnerUserId),
          ),
        )
        .returning();
      if (promoted === undefined) {
        // Should not happen: the row was just locked and confirmed to exist above.
        throw new Error("business_members row for the new owner disappeared mid-transaction");
      }

      return { ok: true, previousOwner: toDomain(demoted), newOwner: toDomain(promoted) };
    });
  }
}

function toDomain(row: typeof businessMembers.$inferSelect) {
  return {
    businessId: row.businessId,
    userId: row.userId,
    role: row.role,
    invitedAt: row.invitedAt.toISOString(),
    invitedByUserId: row.invitedByUserId,
    joinedAt: row.joinedAt === null ? null : row.joinedAt.toISOString(),
  };
}
