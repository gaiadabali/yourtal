import { and, eq } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { saves } from "./schema/me-schema";

/** `me.save` (5.4.a) — a private "watch later" list. */
export interface SaveRepository {
  listForUser(userId: string): Promise<string[]>;
  save(userId: string, campaignId: string): Promise<void>;
  unsave(userId: string, campaignId: string): Promise<void>;
}

export const SAVE_REPOSITORY = Symbol("SAVE_REPOSITORY");

export class DrizzleSaveRepository implements SaveRepository {
  constructor(private readonly db: AppDb) {}

  async listForUser(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ campaignId: saves.campaignId })
      .from(saves)
      .where(eq(saves.userId, userId));
    return rows.map((row) => row.campaignId);
  }

  async save(userId: string, campaignId: string): Promise<void> {
    await this.db
      .insert(saves)
      .values({ userId, campaignId })
      .onConflictDoNothing({ target: [saves.userId, saves.campaignId] });
  }

  async unsave(userId: string, campaignId: string): Promise<void> {
    await this.db
      .delete(saves)
      .where(and(eq(saves.userId, userId), eq(saves.campaignId, campaignId)));
  }
}
