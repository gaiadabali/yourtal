import { eq } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { interests } from "./schema/me-schema";

/** `me.interest` (5.4.a) — declared interests only, never inferred. */
export interface InterestRepository {
  listForUser(userId: string): Promise<string[]>;
  /** Replaces the whole declared set in one transaction. */
  replaceForUser(userId: string, nodeIds: readonly string[]): Promise<void>;
}

export const INTEREST_REPOSITORY = Symbol("INTEREST_REPOSITORY");

export class DrizzleInterestRepository implements InterestRepository {
  constructor(private readonly db: AppDb) {}

  async listForUser(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ nodeId: interests.nodeId })
      .from(interests)
      .where(eq(interests.userId, userId));
    return rows.map((row) => row.nodeId);
  }

  async replaceForUser(userId: string, nodeIds: readonly string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(interests).where(eq(interests.userId, userId));
      if (nodeIds.length === 0) return;
      await tx.insert(interests).values(nodeIds.map((nodeId) => ({ userId, nodeId })));
    });
  }
}
