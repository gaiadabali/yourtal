import { bigserial, integer, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Applied by `packages/db/migrations/20260920000013_watch_session.sql`. */
export const watchPgSchema = pgSchema("watch");

export const watchSessions = watchPgSchema.table("session", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  campaignId: uuid("campaign_id").notNull(),
  termsVersion: integer("terms_version").notNull(),
  state: text("state").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  lastProgressAt: timestamp("last_progress_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

/**
 * Append-only. The app role has INSERT and SELECT and no UPDATE or DELETE —
 * this is the evidence a reward is paid against, and evidence that can be
 * edited after the fact is not evidence.
 */
export const watchCoverage = watchPgSchema.table("coverage", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  sessionId: uuid("session_id").notNull(),
  fromSecond: integer("from_second").notNull(),
  toSecond: integer("to_second").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
});
