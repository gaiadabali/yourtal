import { and, eq, gt, gte } from "drizzle-orm";
import { regionDateString } from "@yourtal/contracts/me/streak";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
// Read-only: this module never writes `watch.session` — that table and its
// repository are A's (`../watch/persistence/drizzle-watch-session.repository.ts`,
// owned by the parallel 5.1-5.3 session this phase). Importing the schema
// definition to run a narrow SELECT of our own is the same pattern
// `campaign.controller.ts`/`watch.controller.ts` already use for reading
// C's campaign tables — see TASKS.md "Areas and ownership".
import { watchSessions } from "../../watch/persistence/schema/watch.table";

/**
 * The distinct region-calendar days (5.5.a, F16) a user completed at least
 * one reward session on, since a given date. Feeds `advanceStreak`
 * (`@yourtal/contracts/me/streak`) — this reader turns raw completion
 * timestamps into the days that function actually counts.
 */
export interface CompletedWatchDaysReader {
  /**
   * Sorted ascending. `sinceDate` is exclusive (matches `lastCountedDate`'s
   * own semantics in `advanceStreak`) — pass `null` for "every day on record".
   */
  distinctDaysSince(
    userId: string,
    region: "AU" | "ID",
    sinceDate: string | null,
  ): Promise<string[]>;
}

export const COMPLETED_WATCH_DAYS_READER = Symbol("COMPLETED_WATCH_DAYS_READER");

export class DrizzleCompletedWatchDaysReader implements CompletedWatchDaysReader {
  constructor(private readonly db: AppDb) {}

  async distinctDaysSince(
    userId: string,
    region: "AU" | "ID",
    sinceDate: string | null,
  ): Promise<string[]> {
    const conditions = [eq(watchSessions.userId, userId), eq(watchSessions.state, "completed")];
    // A generous lookback bound (400 days) rather than an unbounded scan,
    // even for a user with no stored streak yet — `sinceDate === null`
    // still means "recent history", not "this account's entire lifetime".
    const floor =
      sinceDate === null
        ? new Date(Date.now() - 400 * 24 * 60 * 60 * 1000)
        : new Date(`${sinceDate}T00:00:00Z`);
    conditions.push(
      sinceDate === null
        ? gte(watchSessions.completedAt, floor)
        : gt(watchSessions.completedAt, floor),
    );

    const rows = await this.db
      .select({ completedAt: watchSessions.completedAt })
      .from(watchSessions)
      .where(and(...conditions));

    const days = new Set<string>();
    for (const row of rows) {
      if (row.completedAt === null) continue;
      const day = regionDateString(row.completedAt, region);
      if (sinceDate === null || day > sinceDate) days.add(day);
    }
    return [...days].sort();
  }
}
