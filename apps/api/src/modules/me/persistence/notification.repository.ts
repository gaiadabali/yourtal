import { and, desc, eq } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { notificationPreferences, notifications } from "./schema/me-schema";

/**
 * Every category `me-notifications-section.tsx` actually surfaces a toggle
 * for today -- new ones (`points_expiring`, a followed-channel campaign,
 * 5.5.b) join this list as they're wired end to end, the same "shows only
 * the one real category" note that component's own header carries.
 *
 * 12.4.b (#8): `NotificationsController.preferences` (the GET, read side)
 * uses this to report the age-appropriate default for a category the
 * caller has never made an explicit choice on -- see `pushEnabledDefaultFor`
 * below. A category not on this list has no toggle anywhere yet, so there
 * is nothing for a default to be shown FOR.
 */
export const DEFAULT_NOTIFICATION_CATEGORIES: readonly string[] = ["points_unlocked"];

/**
 * `me.notification_preference.push_enabled DEFAULT true` (the migration's
 * own column default) is a fresh account's storage default, not this
 * product's -- F12/12.2.b already silence a teen's push in other ways
 * (quiet hours), and a teen who has never touched notification settings
 * should not start opted into push either. `undefined`/`"adult"` -> `true`,
 * matching the column's own default so an adult's experience is unchanged;
 * `"teen"` -> `false`. An EXPLICIT choice always wins regardless (this is
 * only ever consulted for a category with no stored row) -- see the
 * controller's own comment.
 */
export function pushEnabledDefaultFor(ageBand: "teen" | "adult" | undefined): boolean {
  return ageBand !== "teen";
}

export interface NewNotification {
  readonly userId: string;
  readonly region: string;
  readonly category: string;
  readonly title: string;
  readonly body: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface StoredNotification extends NewNotification {
  readonly id: number;
  readonly createdAt: string;
  readonly readAt: string | null;
}

/** `me.notification` / `me.notification_preference` (5.5.b). */
export interface NotificationRepository {
  create(notification: NewNotification): Promise<StoredNotification>;
  listForUser(userId: string, limit: number): Promise<StoredNotification[]>;
  markRead(userId: string, id: number, at: Date): Promise<void>;
  preferencesFor(userId: string): Promise<ReadonlyMap<string, boolean>>;
  setPreference(userId: string, category: string, pushEnabled: boolean): Promise<void>;
}

export const NOTIFICATION_REPOSITORY = Symbol("NOTIFICATION_REPOSITORY");

export class DrizzleNotificationRepository implements NotificationRepository {
  constructor(private readonly db: AppDb) {}

  async create(notification: NewNotification): Promise<StoredNotification> {
    const rows = await this.db
      .insert(notifications)
      .values({
        userId: notification.userId,
        region: notification.region,
        category: notification.category,
        title: notification.title,
        body: notification.body,
        metadata: notification.metadata ?? null,
      })
      .returning();
    const row = rows[0];
    if (row === undefined) throw new Error("notification insert returned no row");
    return toStored(row);
  }

  async listForUser(userId: string, limit: number): Promise<StoredNotification[]> {
    const rows = await this.db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
    return rows.map(toStored);
  }

  async markRead(userId: string, id: number, at: Date): Promise<void> {
    await this.db
      .update(notifications)
      .set({ readAt: at })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
  }

  async preferencesFor(userId: string): Promise<ReadonlyMap<string, boolean>> {
    const rows = await this.db
      .select({
        category: notificationPreferences.category,
        pushEnabled: notificationPreferences.pushEnabled,
      })
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId));
    return new Map(rows.map((row) => [row.category, row.pushEnabled]));
  }

  async setPreference(userId: string, category: string, pushEnabled: boolean): Promise<void> {
    await this.db
      .insert(notificationPreferences)
      .values({ userId, category, pushEnabled })
      .onConflictDoUpdate({
        target: [notificationPreferences.userId, notificationPreferences.category],
        set: { pushEnabled },
      });
  }
}

function toStored(row: {
  id: number;
  userId: string;
  region: string;
  category: string;
  title: string;
  body: string;
  metadata: unknown;
  createdAt: Date;
  readAt: Date | null;
}): StoredNotification {
  return {
    id: row.id,
    userId: row.userId,
    region: row.region,
    category: row.category,
    title: row.title,
    body: row.body,
    ...(row.metadata === null || row.metadata === undefined
      ? {}
      : { metadata: row.metadata as Record<string, unknown> }),
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
  };
}
