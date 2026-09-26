import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { CoverageInterval } from "@yourtal/contracts/watch/coverage";
import type { ReportRefusal } from "@yourtal/contracts/watch/progress-report";
import { judgeProgressReport } from "@yourtal/contracts/watch/progress-report";
import type { WatchSession, WatchSessionState } from "@yourtal/contracts/watch/session";
import { watchSessionSchema } from "@yourtal/contracts/watch/session";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { watchCoverage, watchSessions } from "./schema/watch.table";

export interface StartOrResumeInput {
  readonly userId: string;
  readonly campaignId: string;
  readonly termsVersion: number;
}

export interface EarningOutcome {
  readonly nonEarning: boolean;
  readonly nonEarningReason: string | null;
  readonly holdId: string | null;
}

export type ProgressOutcome =
  | { readonly kind: "accepted"; readonly coverage: readonly CoverageInterval[] }
  | { readonly kind: "refused"; readonly reason: ReportRefusal }
  | { readonly kind: "not_active"; readonly state: WatchSessionState }
  | { readonly kind: "missing" };

type SessionRow = typeof watchSessions.$inferSelect;

export interface WatchSessionRepository {
  /**
   * Starts a new attempt, or reactivates one already open for this exact
   * (user, campaign, terms version) tuple. 5.1.b.
   *
   * Returns `resumed: true` when an existing `active`/`parked` row for this
   * tuple was reactivated (same id, coverage untouched) rather than a new
   * one created. A FRESH row is inserted with a placeholder non-earning
   * outcome (`"pending_funding_check"`) — the caller must follow up with
   * `finalizeEarningOutcome` exactly when `resumed` is `false`, once it has
   * checked already-earned and (if not) taken the allocation hold. That
   * split exists because the hold is a LEDGER call, and this repository
   * must not reach across that boundary itself.
   */
  startOrResume(input: StartOrResumeInput): Promise<{ session: WatchSession; resumed: boolean }>;
  /** Sets the real earning outcome on a freshly-created session. Never call this on a resumed one. */
  finalizeEarningOutcome(sessionId: string, outcome: EarningOutcome): Promise<void>;
  findById(sessionId: string): Promise<WatchSession | null>;
  coverageFor(sessionId: string): Promise<CoverageInterval[]>;
  /**
   * Judges and (if accepted) records one progress report, under a
   * per-session row lock — the whole of EW-01's fix in one place: the lock
   * stops two concurrent reports computing the cumulative budget from the
   * same stale base, and `judgeProgressReport` (run INSIDE the lock, against
   * the coverage the lock just read) stops either one claiming more than
   * the session's wall-clock elapsed time allows.
   */
  recordProgress(
    sessionId: string,
    report: { fromSeconds: number; toSeconds: number },
    durationSeconds: number,
    now: Date,
  ): Promise<ProgressOutcome>;
  /**
   * Whether this user has ALREADY been granted this campaign's reward
   * (5.1.b's `already_earned`). Read from `granted`, not `non_earning`:
   * `granted` is set only once `grantReward` actually succeeds, which is
   * the fact that matters here — a session that merely INTENDED to earn but
   * whose grant call failed for some other reason must not block a future
   * honest attempt.
   */
  hasBeenGranted(userId: string, campaignId: string): Promise<boolean>;
  /**
   * Transitions `active` -> `completed`. Returns whether THIS call is the
   * one that matched — the idempotency of the reward (EW-10): two
   * concurrent completions both pass the coverage check, and only the one
   * that wins this conditional update may call `grantReward`.
   */
  markCompleted(sessionId: string, at: Date): Promise<boolean>;
  /** Records that a completed session's grant actually landed. Idempotent — a replay simply confirms `true`. */
  markGranted(sessionId: string): Promise<void>;
}

export const WATCH_SESSION_REPOSITORY = Symbol("WATCH_SESSION_REPOSITORY");

function toWatchSession(row: SessionRow): WatchSession {
  // Parsed, not cast — a row the contract rejects is a bug worth failing on
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
    nonEarning: row.nonEarning,
    nonEarningReason: row.nonEarningReason,
    holdId: row.holdId,
    granted: row.granted,
    questionsAsked: row.questionsAsked,
    questionsCorrect: row.questionsCorrect,
  });
}

export class DrizzleWatchSessionRepository implements WatchSessionRepository {
  constructor(private readonly db: AppDb) {}

  /**
   * See the interface doc. One transaction, with every row this decision
   * touches locked up front (`FOR UPDATE`) before any of them is written —
   * two concurrent starts for the same tuple must not both decide "no open
   * row exists" and both insert, which `session_one_open_per_user_campaign_terms`
   * would then have to referee by failing one request outright instead of
   * this method resolving it into a clean reactivation.
   */
  async startOrResume(
    input: StartOrResumeInput,
  ): Promise<{ session: WatchSession; resumed: boolean }> {
    return this.db.transaction(async (tx) => {
      const openForTuple = await tx
        .select()
        .from(watchSessions)
        .where(
          and(
            eq(watchSessions.userId, input.userId),
            eq(watchSessions.campaignId, input.campaignId),
            eq(watchSessions.termsVersion, input.termsVersion),
            inArray(watchSessions.state, ["active", "parked"]),
          ),
        )
        .for("update")
        .limit(1);

      const currentActive = await tx
        .select()
        .from(watchSessions)
        .where(and(eq(watchSessions.userId, input.userId), eq(watchSessions.state, "active")))
        .for("update")
        .limit(1);

      const tuple = openForTuple[0];
      if (tuple !== undefined) {
        const active = currentActive[0];
        if (active !== undefined && active.id !== tuple.id) {
          // A DIFFERENT campaign (or an earlier terms version of this one)
          // was active. Park it — it stays resumable — rather than
          // superseding it, which would forfeit its coverage for good.
          await tx
            .update(watchSessions)
            .set({ state: "parked" })
            .where(eq(watchSessions.id, active.id));
        }
        if (tuple.state !== "active") {
          await tx
            .update(watchSessions)
            .set({ state: "active" })
            .where(eq(watchSessions.id, tuple.id));
        }
        const reactivatedRows = await tx
          .select()
          .from(watchSessions)
          .where(eq(watchSessions.id, tuple.id))
          .limit(1);
        const reactivatedRow = reactivatedRows[0];
        if (reactivatedRow === undefined) {
          throw new Error(`watch session ${tuple.id} vanished inside its own transaction`);
        }
        return { session: toWatchSession(reactivatedRow), resumed: true };
      }

      // No open row for this exact tuple. Whatever the user had active
      // (any campaign) is parked; anything open for THIS campaign under an
      // OLDER terms version is superseded — not resumable, since the terms
      // changed under it (watch-session.ts's own comment on `superseded`).
      const active = currentActive[0];
      if (active !== undefined) {
        await tx
          .update(watchSessions)
          .set({ state: "parked" })
          .where(eq(watchSessions.id, active.id));
      }
      const staleForCampaign = await tx
        .select({ id: watchSessions.id })
        .from(watchSessions)
        .where(
          and(
            eq(watchSessions.userId, input.userId),
            eq(watchSessions.campaignId, input.campaignId),
            inArray(watchSessions.state, ["active", "parked"]),
            ne(watchSessions.termsVersion, input.termsVersion),
          ),
        )
        .for("update");
      for (const stale of staleForCampaign) {
        await tx
          .update(watchSessions)
          .set({ state: "superseded" })
          .where(eq(watchSessions.id, stale.id));
      }

      const id = randomUUID();
      const now = new Date();
      await tx.insert(watchSessions).values({
        id,
        userId: input.userId,
        campaignId: input.campaignId,
        termsVersion: input.termsVersion,
        state: "active",
        startedAt: now,
        lastProgressAt: now,
        completedAt: null,
        // A placeholder the controller MUST replace via
        // `finalizeEarningOutcome` before this response reaches anyone —
        // the real hold/already-earned decision needs the ledger, which
        // this repository does not call.
        nonEarning: true,
        nonEarningReason: "pending_funding_check",
        holdId: null,
        questionsAsked: 0,
        questionsCorrect: 0,
        granted: false,
      });
      const createdRows = await tx
        .select()
        .from(watchSessions)
        .where(eq(watchSessions.id, id))
        .limit(1);
      const createdRow = createdRows[0];
      if (createdRow === undefined) {
        throw new Error(`watch session ${id} vanished immediately after being created`);
      }
      return { session: toWatchSession(createdRow), resumed: false };
    });
  }

  async finalizeEarningOutcome(sessionId: string, outcome: EarningOutcome): Promise<void> {
    await this.db
      .update(watchSessions)
      .set({
        nonEarning: outcome.nonEarning,
        nonEarningReason: outcome.nonEarningReason,
        holdId: outcome.holdId,
      })
      .where(eq(watchSessions.id, sessionId));
  }

  async findById(sessionId: string): Promise<WatchSession | null> {
    const rows = await this.db
      .select()
      .from(watchSessions)
      .where(eq(watchSessions.id, sessionId))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toWatchSession(row);
  }

  async coverageFor(sessionId: string): Promise<CoverageInterval[]> {
    const rows = await this.db
      .select({ fromSecond: watchCoverage.fromSecond, toSecond: watchCoverage.toSecond })
      .from(watchCoverage)
      .where(eq(watchCoverage.sessionId, sessionId))
      .orderBy(asc(watchCoverage.fromSecond));
    return rows;
  }

  async recordProgress(
    sessionId: string,
    report: { fromSeconds: number; toSeconds: number },
    durationSeconds: number,
    now: Date,
  ): Promise<ProgressOutcome> {
    return this.db.transaction(async (tx) => {
      // The row lock EW-01 needed: every concurrent report for this session
      // now serialises here, so the coverage read two lines down can never
      // be stale by the time it is judged and written.
      const rows = await tx
        .select()
        .from(watchSessions)
        .where(eq(watchSessions.id, sessionId))
        .for("update")
        .limit(1);
      const session = rows[0];
      if (session === undefined) return { kind: "missing" };
      if (session.state !== "active") {
        return { kind: "not_active", state: session.state as WatchSessionState };
      }

      const existingCoverage = await tx
        .select({ fromSecond: watchCoverage.fromSecond, toSecond: watchCoverage.toSecond })
        .from(watchCoverage)
        .where(eq(watchCoverage.sessionId, sessionId));

      const verdict = judgeProgressReport(
        { sessionId, ...report, reportedAt: now.toISOString() },
        {
          startedAtMs: session.startedAt.getTime(),
          nowServerMs: now.getTime(),
          durationSeconds,
          existingCoverage,
        },
      );
      if (!verdict.accepted) return { kind: "refused", reason: verdict.reason };

      await tx.insert(watchCoverage).values({
        sessionId,
        fromSecond: verdict.interval.fromSecond,
        toSecond: verdict.interval.toSecond,
        recordedAt: now,
      });
      await tx
        .update(watchSessions)
        .set({ lastProgressAt: now })
        .where(eq(watchSessions.id, sessionId));

      return { kind: "accepted", coverage: [...existingCoverage, verdict.interval] };
    });
  }

  async hasBeenGranted(userId: string, campaignId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: watchSessions.id })
      .from(watchSessions)
      .where(
        and(
          eq(watchSessions.userId, userId),
          eq(watchSessions.campaignId, campaignId),
          eq(watchSessions.granted, true),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * The `state = 'active'` predicate is the idempotency of the reward
   * (EW-10): two concurrent completion requests both pass the coverage
   * check, and exactly one of them matches this row. `.returning()` is what
   * tells the two apart — the loser gets an empty array back and must not
   * call `grantReward`.
   */
  async markCompleted(sessionId: string, at: Date): Promise<boolean> {
    const updated = await this.db
      .update(watchSessions)
      .set({ state: "completed", completedAt: at })
      .where(and(eq(watchSessions.id, sessionId), eq(watchSessions.state, "active")))
      .returning({ id: watchSessions.id });
    return updated.length > 0;
  }

  async markGranted(sessionId: string): Promise<void> {
    await this.db
      .update(watchSessions)
      .set({ granted: true })
      .where(eq(watchSessions.id, sessionId));
  }
}
