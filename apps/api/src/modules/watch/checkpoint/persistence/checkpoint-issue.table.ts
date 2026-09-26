import { integer, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Applied by `packages/db/migrations/20260926130100_watch_checkpoint_issue.sql`. EW-08. */
export const watchPgSchema = pgSchema("watch");

export const checkpointIssues = watchPgSchema.table("checkpoint_issue", {
  sessionId: uuid("session_id").notNull(),
  checkpointIndex: integer("checkpoint_index").notNull(),
  nonce: text("nonce").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
