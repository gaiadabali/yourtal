import { integer, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { spambankPgSchema } from "./spambank-schema";

/**
 * `spambank.app_event_outbox` (B8): signed mail events for SnapApp, kept apart
 * from `oidc.event_outbox` so a stuck new-mail alert never delays an
 * `account-deleted`. Same columns, plus `expires_at` (alerts 15 min, statements 24 h).
 */
export const appEventOutbox = spambankPgSchema.table("app_event_outbox", {
  jti: uuid("jti").primaryKey(),
  clientId: text("client_id").notNull(),
  sub: text("sub").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  iat: timestamp("iat", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  lastError: text("last_error"),
});
