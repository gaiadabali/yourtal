import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { CoverageInterval } from "@yourtal/contracts/watch/coverage";
import type { WatchSession } from "@yourtal/contracts/watch/session";
import { watchSessionSchema } from "@yourtal/contracts/watch/session";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { watchCoverage, watchSessions } from "./schema/watch.table";

export interface WatchSessionRepository {
  start(userId: string, campaignId: string, termsVersion: number): Promise<WatchSession>;
  findById(sessionId: string): Promise<WatchSession | null>;
  coverageFor(sessionId: string): Promise<CoverageInterval[]>;
  recordCoverage(sessionId: string, interval: CoverageInterval, at: Date): Promise<void>;
  markCompleted(sessionId: string, at: Date): Promise<void>;
}

export const WATCH_SESSION_REPOSITORY = Symbol("WATCH_SESSION_REPOSITORY");

export class DrizzleWatchSessionRepository implements WatchSessionRepository {
  constructor(private readonly db: AppDb) {}

  /**
   * Starts a session, superseding whatever the user had open.
   *
   * Supersede rather than refuse: somebody who closed a tab and came back
   * would otherwise be stuck with a session they cannot see and cannot
   * replace. The old attempt is marked `superseded` and kept — its coverage
   * is evidence, and deleting it would destroy the record of what a user
   * actually watched.
   *
   * Both statements run in ONE transaction. Between them the user briefly
   * has no active session, and a concurrent start would otherwise slip into
   * that window and leave two — which the partial unique index would then
   * refuse, failing the wrong request.
   */
  async start(userId: string, campaignId: string, termsVersion: number): Promise<WatchSession> {
    const now = new Date();
    const id = randomUUID();

    await this.db.transaction(async (tx) => {
      await tx
        .update(watchSessions)
        .set({ state: "superseded" })
        .where(and(eq(watchSessions.userId, userId), eq(watchSessions.state, "active")));

      await tx.insert(watchSessions).values({
        id,
        userId,
        campaignId,
        termsVersion,
        state: "active",
        startedAt: now,
        lastProgressAt: now,
        completedAt: null,
      });
    });

    const started = await this.findById(id);
    if (started === null) {
      throw new Error(`Watch session ${id} vanished immediately after being created`);
    }
    return started;
  }

  async findById(sessionId: string): Promise<WatchSession | null> {
    const rows = await this.db
      .select()
      .from(watchSessions)
      .where(eq(watchSessions.id, sessionId))
      .limit(1);

    const row = rows[0];
    if (row === undefined) return null;

    // Parsed, not cast. A row the contract rejects is a bug worth failing on
    // rather than a shape to serve.
    return watchSessionSchema.parse({
      id: row.id,
      userId: row.userId,
      campaignId: row.campaignId,
      termsVersion: row.termsVersion,
      state: row.state,
      startedAt: row.startedAt.toISOString(),
      lastProgressAt: row.lastProgressAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    });
  }

  async coverageFor(sessionId: string): Promise<CoverageInterval[]> {
    const rows = await this.db
      .select({ fromSecond: watchCoverage.fromSecond, toSecond: watchCoverage.toSecond })
      .from(watchCoverage)
      .where(eq(watchCoverage.sessionId, sessionId))
      .orderBy(asc(watchCoverage.fromSecond));
    return rows;
  }

  /**
   * Records one accepted span and advances the progress clock together.
   *
   * One transaction, because `last_progress_at` is what the rate check
   * measures the NEXT report against. If the insert succeeded and the clock
   * update did not, the following report would be judged against a stale
   * timestamp and a client could claim a long span it never played.
   */
  async recordCoverage(sessionId: string, interval: CoverageInterval, at: Date): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(watchCoverage).values({
        sessionId,
        fromSecond: interval.fromSecond,
        toSecond: interval.toSecond,
        recordedAt: at,
      });
      await tx
        .update(watchSessions)
        .set({ lastProgressAt: at })
        .where(eq(watchSessions.id, sessionId));
    });
  }

  /**
   * Marks completion, and only from `active`.
   *
   * The `state = 'active'` predicate is the idempotency of the reward: two
   * concurrent completion requests both pass the coverage check, and exactly
   * one of them matches a row here. Without it, a double-submit would
   * complete twice and — once the Reward Engine is wired — grant twice.
   */
  async markCompleted(sessionId: string, at: Date): Promise<void> {
    await this.db
      .update(watchSessions)
      .set({ state: "completed", completedAt: at })
      .where(and(eq(watchSessions.id, sessionId), eq(watchSessions.state, "active")));
  }
}
