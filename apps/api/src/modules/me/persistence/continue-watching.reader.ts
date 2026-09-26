import { asc, desc, eq, inArray } from "drizzle-orm";
import { coveredSeconds, mergeCoverage } from "@yourtal/contracts/watch/coverage";
import type { CoverageInterval } from "@yourtal/contracts/watch/coverage";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
// Read-only, same reasoning as completed-watch-days.reader.ts: A owns
// `watch.session`/`watch.coverage` this phase; this is a narrow SELECT of
// our own over their schema, not an edit to their repository.
import { watchCoverage, watchSessions } from "../../watch/persistence/schema/watch.table";

export interface ContinueWatchingEntry {
  readonly sessionId: string;
  readonly campaignId: string;
  readonly state: string;
  readonly startedAt: string;
  readonly lastProgressAt: string;
  readonly coveredSeconds: number;
}

/** `GET /api/me/sessions` (5.4.a) — "continue watching": parked and active sessions with coverage. */
export interface ContinueWatchingReader {
  forUser(userId: string, limit: number): Promise<ContinueWatchingEntry[]>;
}

export const CONTINUE_WATCHING_READER = Symbol("CONTINUE_WATCHING_READER");

const RESUMABLE_STATES = ["active", "superseded"] as const;

export class DrizzleContinueWatchingReader implements ContinueWatchingReader {
  constructor(private readonly db: AppDb) {}

  async forUser(userId: string, limit: number): Promise<ContinueWatchingEntry[]> {
    const sessions = await this.db
      .select()
      .from(watchSessions)
      .where(eq(watchSessions.userId, userId))
      .orderBy(desc(watchSessions.lastProgressAt))
      .limit(limit);

    // "Parked" is O-4's own vocabulary for a session that is not active any
    // more but was not completed either — `superseded` (start.ts supersedes
    // whatever was open) is the only state that means that today.
    const resumable = sessions.filter((row) => RESUMABLE_STATES.includes(row.state as "active"));
    if (resumable.length === 0) return [];

    const ids = resumable.map((row) => row.id);
    const coverage = await this.db
      .select({
        sessionId: watchCoverage.sessionId,
        fromSecond: watchCoverage.fromSecond,
        toSecond: watchCoverage.toSecond,
      })
      .from(watchCoverage)
      .where(inArray(watchCoverage.sessionId, ids))
      .orderBy(asc(watchCoverage.fromSecond));

    const spansBySession = new Map<string, CoverageInterval[]>();
    for (const span of coverage) {
      const existing = spansBySession.get(span.sessionId) ?? [];
      existing.push({ fromSecond: span.fromSecond, toSecond: span.toSecond });
      spansBySession.set(span.sessionId, existing);
    }

    return resumable.map((row) => ({
      sessionId: row.id,
      campaignId: row.campaignId,
      state: row.state,
      startedAt: row.startedAt.toISOString(),
      lastProgressAt: row.lastProgressAt.toISOString(),
      coveredSeconds: coveredSeconds(mergeCoverage(spansBySession.get(row.id) ?? [])),
    }));
  }
}
