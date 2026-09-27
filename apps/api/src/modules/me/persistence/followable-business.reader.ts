import { asc, eq, inArray } from "drizzle-orm";
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
 * The display fields both Me's own follow list (6.7.a) and onboarding's
 * "follow 3 channels" picker (6.2.b) need — a channel name, handle and
 * logo, never a follower count or anything the business itself publishes
 * back to other users (this app has no user-to-user surface).
 */
export interface FollowableBusinessSummary {
  readonly id: string;
  readonly displayName: string;
  readonly handle: string;
  readonly logoUrl: string | null;
}

/** Whether a business exists and, if so, which region it belongs to (F2). */
export interface FollowableBusinessReader {
  findById(businessId: string): Promise<FollowableBusiness | null>;
  /** Display fields for a caller-supplied id set, for the follow list (order not guaranteed). */
  summariesByIds(businessIds: readonly string[]): Promise<FollowableBusinessSummary[]>;
  /**
   * Candidates for the onboarding "follow 3 channels" step: every business
   * in `region`, minus `excludeIds` (already followed), ordered by name so
   * the list is stable across a re-render rather than shuffling. No
   * discovery/ranking logic — that is Phase 11's feed, not this stopgap.
   */
  listCandidates(
    region: string,
    excludeIds: readonly string[],
    limit: number,
  ): Promise<FollowableBusinessSummary[]>;
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

  async summariesByIds(businessIds: readonly string[]): Promise<FollowableBusinessSummary[]> {
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

  async listCandidates(
    region: string,
    excludeIds: readonly string[],
    limit: number,
  ): Promise<FollowableBusinessSummary[]> {
    // drizzle's `notInArray` with an empty array produces an always-false
    // WHERE clause on some dialects; guard it explicitly rather than rely
    // on that.
    const rows = await this.db
      .select({
        id: businessAccounts.id,
        displayName: businessAccounts.displayName,
        handle: businessAccounts.handle,
        logoUrl: businessAccounts.logoUrl,
        region: businessAccounts.region,
      })
      .from(businessAccounts)
      .where(eq(businessAccounts.region, region))
      .orderBy(asc(businessAccounts.displayName))
      .limit(limit + excludeIds.length);
    const excluded = new Set(excludeIds);
    return rows.filter((row) => !excluded.has(row.id)).slice(0, limit);
  }
}
