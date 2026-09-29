import { integer, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { watchPgSchema } from "../persistence/schema/watch.table";

/**
 * Applied by `packages/db/migrations/20260929090000_watch_open_view_session.sql`.
 * 11.2.b: Open Viewing's anonymous, non-earning watch session — a separate
 * table from `watch.session` (see that migration's own header for why).
 */
export const openViewSessions = watchPgSchema.table("open_view_session", {
  id: uuid("id").primaryKey(),
  campaignId: uuid("campaign_id").notNull(),
  region: text("region").notNull(),
  ipHash: text("ip_hash").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  lastProgressAt: timestamp("last_progress_at", { withTimezone: true }).notNull(),
  watchedSeconds: integer("watched_seconds").notNull(),
});
