import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { openViewSessions } from "./open-view-session.table";

/** How long since its last progress report a row still counts as "the one active session" (11.2.b). */
const IDLE_WINDOW_SECONDS = 10 * 60;

/** The F12 daily cap is a ROLLING window, not a calendar-day bucket with a midnight reset to game. */
const DAILY_WINDOW_SECONDS = 24 * 60 * 60;

export interface OpenViewSession {
  readonly id: string;
  readonly campaignId: string;
  readonly region: string;
  readonly watchedSeconds: number;
}

export interface OpenViewSessionRepository {
  /** An active (within the idle window) session for this exact IP + campaign, to resume rather than duplicate. */
  findActiveForIpAndCampaign(ipHash: string, campaignId: string): Promise<OpenViewSession | null>;
  /** How many DISTINCT campaigns this IP has an active (within the idle window) session on right now — the "one concurrent session" count. */
  countActiveForIp(ipHash: string): Promise<number>;
  /** Total seconds watched by this IP across the rolling daily window — every campaign, this region. */
  watchedSecondsToday(ipHash: string, region: string): Promise<number>;
  create(input: { campaignId: string; region: string; ipHash: string }): Promise<OpenViewSession>;
  /** Belongs to this exact ipHash, or `null` — never lets one IP extend another's session. */
  findByIdForIp(sessionId: string, ipHash: string): Promise<OpenViewSession | null>;
  /** Adds `deltaSeconds` (never negative) to the session's running total and touches `last_progress_at`. */
  addProgress(sessionId: string, deltaSeconds: number): Promise<OpenViewSession>;
}

function toSession(row: typeof openViewSessions.$inferSelect): OpenViewSession {
  return {
    id: row.id,
    campaignId: row.campaignId,
    region: row.region,
    watchedSeconds: row.watchedSeconds,
  };
}

export class DrizzleOpenViewSessionRepository implements OpenViewSessionRepository {
  constructor(private readonly db: AppDb) {}

  async findActiveForIpAndCampaign(
    ipHash: string,
    campaignId: string,
  ): Promise<OpenViewSession | null> {
    const [row] = await this.db
      .select()
      .from(openViewSessions)
      .where(
        and(
          eq(openViewSessions.ipHash, ipHash),
          eq(openViewSessions.campaignId, campaignId),
          gt(openViewSessions.lastProgressAt, sql`now() - make_interval(secs => ${IDLE_WINDOW_SECONDS})`),
        ),
      )
      .orderBy(desc(openViewSessions.lastProgressAt))
      .limit(1);
    return row ? toSession(row) : null;
  }

  async countActiveForIp(ipHash: string): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<string>`count(distinct ${openViewSessions.campaignId})` })
      .from(openViewSessions)
      .where(
        and(
          eq(openViewSessions.ipHash, ipHash),
          gt(openViewSessions.lastProgressAt, sql`now() - make_interval(secs => ${IDLE_WINDOW_SECONDS})`),
        ),
      );
    return Number(row?.total ?? "0");
  }

  async watchedSecondsToday(ipHash: string, region: string): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<string>`coalesce(sum(${openViewSessions.watchedSeconds}), 0)::text` })
      .from(openViewSessions)
      .where(
        and(
          eq(openViewSessions.ipHash, ipHash),
          eq(openViewSessions.region, region),
          gt(openViewSessions.startedAt, sql`now() - make_interval(secs => ${DAILY_WINDOW_SECONDS})`),
        ),
      );
    return Number(row?.total ?? "0");
  }

  async create(input: {
    campaignId: string;
    region: string;
    ipHash: string;
  }): Promise<OpenViewSession> {
    const id = randomUUID();
    const now = new Date();
    const [row] = await this.db
      .insert(openViewSessions)
      .values({
        id,
        campaignId: input.campaignId,
        region: input.region,
        ipHash: input.ipHash,
        startedAt: now,
        lastProgressAt: now,
        watchedSeconds: 0,
      })
      .returning();
    if (!row) {
      throw new Error("Insert into watch.open_view_session returned no row.");
    }
    return toSession(row);
  }

  async findByIdForIp(sessionId: string, ipHash: string): Promise<OpenViewSession | null> {
    const [row] = await this.db
      .select()
      .from(openViewSessions)
      .where(and(eq(openViewSessions.id, sessionId), eq(openViewSessions.ipHash, ipHash)))
      .limit(1);
    return row ? toSession(row) : null;
  }

  async addProgress(sessionId: string, deltaSeconds: number): Promise<OpenViewSession> {
    const safeDelta = Math.max(0, Math.round(deltaSeconds));
    const [row] = await this.db
      .update(openViewSessions)
      .set({
        watchedSeconds: sql`${openViewSessions.watchedSeconds} + ${safeDelta}`,
        lastProgressAt: new Date(),
      })
      .where(eq(openViewSessions.id, sessionId))
      .returning();
    if (!row) {
      throw new Error("No such open-view session to add progress to.");
    }
    return toSession(row);
  }
}

export const OPEN_VIEW_SESSION_REPOSITORY = Symbol("OPEN_VIEW_SESSION_REPOSITORY");
