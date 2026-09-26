import { and, eq } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { follows } from "./schema/me-schema";

export interface FollowedBusiness {
  readonly businessId: string;
  readonly region: string;
}

/** `me.follow` (5.4.a) — a private ranking signal only; no user-to-user surface reads this. */
export interface FollowRepository {
  listForUser(userId: string): Promise<FollowedBusiness[]>;
  isFollowing(userId: string, businessId: string): Promise<boolean>;
  follow(userId: string, businessId: string, region: string): Promise<void>;
  unfollow(userId: string, businessId: string): Promise<void>;
}

export const FOLLOW_REPOSITORY = Symbol("FOLLOW_REPOSITORY");

export class DrizzleFollowRepository implements FollowRepository {
  constructor(private readonly db: AppDb) {}

  async listForUser(userId: string): Promise<FollowedBusiness[]> {
    const rows = await this.db
      .select({ businessId: follows.businessId, region: follows.region })
      .from(follows)
      .where(eq(follows.userId, userId));
    return rows;
  }

  async isFollowing(userId: string, businessId: string): Promise<boolean> {
    const rows = await this.db
      .select({ businessId: follows.businessId })
      .from(follows)
      .where(and(eq(follows.userId, userId), eq(follows.businessId, businessId)))
      .limit(1);
    return rows.length > 0;
  }

  async follow(userId: string, businessId: string, region: string): Promise<void> {
    await this.db
      .insert(follows)
      .values({ userId, businessId, region })
      .onConflictDoNothing({ target: [follows.userId, follows.businessId] });
  }

  async unfollow(userId: string, businessId: string): Promise<void> {
    await this.db
      .delete(follows)
      .where(and(eq(follows.userId, userId), eq(follows.businessId, businessId)));
  }
}
