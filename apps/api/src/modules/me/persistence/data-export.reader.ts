import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { credentials } from "../../auth/persistence/schema/credential.table";
import { campaigns } from "../../campaign/persistence/schema/campaign.table";
import { userProfiles } from "../../identity/persistence/schema/user-profile.table";
import { watchCoverage, watchSessions } from "../../watch/persistence/schema/watch.table";
import {
  linkCodes,
  notificationPreferences,
  notifications,
  viewerSettings,
  viewerThemes,
} from "./schema/me-schema";

export interface ExportAccountRow {
  readonly email: string | null;
  readonly displayName: string;
  readonly region: string;
  readonly displayLocale: string;
  readonly timezone: string;
  readonly dateOfBirth: string;
  readonly parentConsentStatus: string;
  readonly createdAt: Date;
}

export interface ExportWatchSessionRow {
  readonly sessionId: string;
  readonly campaignId: string;
  readonly campaignTitle: string | null;
  readonly state: string;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly rewarded: boolean;
  /** The spans of the video this session reported watching, in seconds. */
  readonly watchedSpans: readonly { readonly fromSecond: number; readonly toSecond: number }[];
}

/** What the `me` schema and the feed hold about a viewer beyond the lists the controller already reads. */
export interface ExportPersonalData {
  readonly notifications: readonly {
    readonly category: string;
    readonly title: string;
    readonly body: string;
    readonly createdAt: string;
    readonly readAt: string | null;
  }[];
  readonly settings: {
    readonly autoplay: string | null;
    readonly theme: string | null;
    readonly notificationPreferences: readonly {
      readonly category: string;
      readonly pushEnabled: boolean;
    }[];
  };
  /** Campaigns the viewer asked to see less of. */
  readonly showLess: readonly string[];
  /** One-time codes the viewer issued for a linked app. The code itself is a live secret and is left out. */
  readonly linkCodes: readonly {
    readonly region: string;
    readonly issuedAt: string;
    readonly expiresAt: string;
    readonly usedAt: string | null;
  }[];
  readonly voucherExpiryWarnings: readonly {
    readonly voucherId: string;
    readonly expiresAt: string;
    readonly warnedAt: string;
  }[];
}

/**
 * Read-only SELECTs for the data export (13.3.d): the caller's own account
 * row and watch sessions, nothing keyed by anyone else.
 */
export interface DataExportReader {
  account(userId: string): Promise<ExportAccountRow | null>;
  watchSessions(userId: string, limit: number): Promise<ExportWatchSessionRow[]>;
  personal(userId: string): Promise<ExportPersonalData>;
}

/** A ceiling so one export cannot read an unbounded table. */
const EXPORT_MAX_NOTIFICATIONS = 5000;

export const DATA_EXPORT_READER = Symbol("DATA_EXPORT_READER");

export class DrizzleDataExportReader implements DataExportReader {
  constructor(private readonly db: AppDb) {}

  async account(userId: string): Promise<ExportAccountRow | null> {
    const [profile] = await this.db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);
    if (profile === undefined) return null;
    const [credential] = await this.db
      .select({ identifier: credentials.identifier })
      .from(credentials)
      .where(and(eq(credentials.userId, userId), eq(credentials.kind, "password")))
      .limit(1);
    return {
      email: credential?.identifier ?? null,
      displayName: profile.displayName,
      region: profile.region,
      displayLocale: profile.displayLocale,
      timezone: profile.timezone,
      dateOfBirth: profile.dateOfBirth,
      parentConsentStatus: profile.parentConsentStatus,
      createdAt: profile.createdAt,
    };
  }

  async watchSessions(userId: string, limit: number): Promise<ExportWatchSessionRow[]> {
    const sessions = await this.db
      .select()
      .from(watchSessions)
      .where(eq(watchSessions.userId, userId))
      .orderBy(desc(watchSessions.startedAt))
      .limit(limit);
    if (sessions.length === 0) return [];
    const titles = await this.db
      .select({ id: campaigns.id, title: campaigns.title })
      .from(campaigns)
      .where(inArray(campaigns.id, [...new Set(sessions.map((session) => session.campaignId))]));
    const titleById = new Map(titles.map((row) => [row.id, row.title]));
    const spans = await this.coverageBySession(sessions.map((session) => session.id));
    return sessions.map((session) => ({
      sessionId: session.id,
      campaignId: session.campaignId,
      campaignTitle: titleById.get(session.campaignId) ?? null,
      state: session.state,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      rewarded: session.granted,
      watchedSpans: spans.get(session.id) ?? [],
    }));
  }

  private async coverageBySession(
    sessionIds: readonly string[],
  ): Promise<Map<string, { fromSecond: number; toSecond: number }[]>> {
    const bySession = new Map<string, { fromSecond: number; toSecond: number }[]>();
    if (sessionIds.length === 0) return bySession;
    const rows = await this.db
      .select({
        sessionId: watchCoverage.sessionId,
        fromSecond: watchCoverage.fromSecond,
        toSecond: watchCoverage.toSecond,
      })
      .from(watchCoverage)
      .where(inArray(watchCoverage.sessionId, [...sessionIds]))
      .orderBy(asc(watchCoverage.sessionId), asc(watchCoverage.fromSecond));
    for (const row of rows) {
      const spans = bySession.get(row.sessionId) ?? [];
      spans.push({ fromSecond: row.fromSecond, toSecond: row.toSecond });
      bySession.set(row.sessionId, spans);
    }
    return bySession;
  }

  async personal(userId: string): Promise<ExportPersonalData> {
    const [notes, preferences, autoplay, theme, showLess, codes, warnings] = await Promise.all([
      this.db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, userId))
        .orderBy(desc(notifications.createdAt))
        .limit(EXPORT_MAX_NOTIFICATIONS),
      this.db
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, userId))
        .orderBy(asc(notificationPreferences.category)),
      this.db.select().from(viewerSettings).where(eq(viewerSettings.userId, userId)).limit(1),
      this.db.select().from(viewerThemes).where(eq(viewerThemes.userId, userId)).limit(1),
      this.db.execute<{ campaign_id: string }>(
        sql`SELECT campaign_id FROM feed.demotion WHERE user_id = ${userId} ORDER BY created_at`,
      ),
      this.db
        .select()
        .from(linkCodes)
        .where(eq(linkCodes.userId, userId))
        .orderBy(asc(linkCodes.createdAt)),
      this.db.execute<{ voucher_id: string; expires_at: Date; warned_at: Date }>(
        sql`SELECT voucher_id, expires_at, warned_at FROM me.voucher_expiry_warning
             WHERE user_id = ${userId} ORDER BY warned_at`,
      ),
    ]);
    return {
      notifications: notes.map((row) => ({
        category: row.category,
        title: row.title,
        body: row.body,
        createdAt: row.createdAt.toISOString(),
        readAt: row.readAt?.toISOString() ?? null,
      })),
      settings: {
        autoplay: autoplay[0]?.autoplay ?? null,
        theme: theme[0]?.theme ?? null,
        notificationPreferences: preferences.map((row) => ({
          category: row.category,
          pushEnabled: row.pushEnabled,
        })),
      },
      showLess: showLess.rows.map((row) => row.campaign_id),
      linkCodes: codes.map((row) => ({
        region: row.region,
        issuedAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        usedAt: row.consumedAt?.toISOString() ?? null,
      })),
      voucherExpiryWarnings: warnings.rows.map((row) => ({
        voucherId: row.voucher_id,
        expiresAt: new Date(row.expires_at).toISOString(),
        warnedAt: new Date(row.warned_at).toISOString(),
      })),
    };
  }
}
