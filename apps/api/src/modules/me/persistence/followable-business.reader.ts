import { eq, inArray } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
// Read-only: C owns `business.business_accounts` and its repository
// (`../business/persistence/...`). This is a narrow SELECT of our own over
// their table, the same pattern watch.controller.ts already uses reading
// C's campaign schema — see TASKS.md "Areas and ownership".
import { businessAccounts } from "../../business/persistence/schema/business-account.table";

export interface FollowableBusiness {
  readonly id: string;
  readonly region: string;
}

/**
 * The display fields Me's own follow list shows (6.7.a) — a channel name
 * and handle, never a follower count or anything the business itself
 * publishes back to other users (this app has no user-to-user surface).
 */
export interface FollowedBusinessSummary {
  readonly id: string;
  readonly displayName: string;
  readonly handle: string;
  readonly logoUrl: string | null;
}

/** Whether a business exists and, if so, which region it belongs to (F2). */
export interface FollowableBusinessReader {
  findById(businessId: string): Promise<FollowableBusiness | null>;
  /** Display fields for a caller-supplied id set, for the follow list (order not guaranteed). */
  summariesByIds(businessIds: readonly string[]): Promise<FollowedBusinessSummary[]>;
}

export const FOLLOWABLE_BUSINESS_READER = Symbol("FOLLOWABLE_BUSINESS_READER");

export class DrizzleFollowableBusinessReader implements FollowableBusinessReader {
  constructor(private readonly db: AppDb) {}

  async findById(businessId: string): Promise<FollowableBusiness | null> {
    const rows = await this.db
      .select({ id: businessAccounts.id, region: businessAccounts.region })
      .from(businessAccounts)
      .where(eq(businessAccounts.id, businessId))
      .limit(1);
    return rows[0] ?? null;
  }

  async summariesByIds(businessIds: readonly string[]): Promise<FollowedBusinessSummary[]> {
    if (businessIds.length === 0) return [];
    const rows = await this.db
      .select({
        id: businessAccounts.id,
        displayName: businessAccounts.displayName,
        handle: businessAccounts.handle,
        logoUrl: businessAccounts.logoUrl,
      })
      .from(businessAccounts)
      .where(inArray(businessAccounts.id, [...businessIds]));
    return rows;
  }
}
