import { and, desc, eq, inArray } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { credentials } from "../../auth/persistence/schema/credential.table";
import { campaigns } from "../../campaign/persistence/schema/campaign.table";
import { userProfiles } from "../../identity/persistence/schema/user-profile.table";
import { watchSessions } from "../../watch/persistence/schema/watch.table";

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
}

/**
 * Read-only SELECTs for the data export (13.3.d): the caller's own account
 * row and watch sessions, nothing keyed by anyone else.
 */
export interface DataExportReader {
  account(userId: string): Promise<ExportAccountRow | null>;
  watchSessions(userId: string, limit: number): Promise<ExportWatchSessionRow[]>;
}

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
    return sessions.map((session) => ({
      sessionId: session.id,
      campaignId: session.campaignId,
      campaignTitle: titleById.get(session.campaignId) ?? null,
      state: session.state,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      rewarded: session.granted,
    }));
  }
}
