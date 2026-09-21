import { integer, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Applied by `packages/db/migrations/20260921120000_watch_checkpoint_nonce.sql`.
 *
 * Declared here rather than beside `watch.session` in
 * `../../persistence/schema/watch.table.ts` because that file belongs to
 * YT-0553, which is at `review` awaiting a verifier. A ticket pending
 * verification must not move underneath the person verifying it, so this
 * module brings its own table rather than editing theirs.
 */
export const watchPgSchema = pgSchema("watch");

export const checkpointNonces = watchPgSchema.table("checkpoint_nonce", {
  /**
   * The primary key, which is the whole mechanism. The burn is an INSERT
   * that either wins or conflicts; there is no read.
   */
  nonce: text("nonce").primaryKey(),
  sessionId: uuid("session_id").notNull(),
  checkpointIndex: integer("checkpoint_index").notNull(),
  spentAt: timestamp("spent_at", { withTimezone: true }).notNull(),
  /** The token's own signed expiry, copied so pruning has something to read. */
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
