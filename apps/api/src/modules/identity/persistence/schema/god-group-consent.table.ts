import { bigint, bigserial, text, timestamp } from "drizzle-orm/pg-core";
import { identityPgSchema } from "./identity-schema";

/**
 * `identity.god_group_consent` and its `_status` (god/TASKS.md 9.1), shaped
 * like `@yourtal/consent/god-group-notice`'s record. Applied by
 * `packages/db/migrations/20261128130000_god_group_consent.sql`: the log is
 * append-only (INSERT and SELECT only), and the status row is kept by that
 * migration's trigger, never written by the app.
 */
export const godGroupConsents = identityPgSchema.table("god_group_consent", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: text("user_id").notNull(),
  region: text("region").notNull(),
  noticeId: text("notice_id").notNull(),
  noticeVersion: text("notice_version").notNull(),
  decision: text("decision").notNull(),
  method: text("method").notNull(),
  track: text("track").notNull(),
  guardianUserId: text("guardian_user_id"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const godGroupConsentStatus = identityPgSchema.table("god_group_consent_status", {
  userId: text("user_id").primaryKey(),
  region: text("region").notNull(),
  noticeId: text("notice_id").notNull(),
  noticeVersion: text("notice_version").notNull(),
  decision: text("decision").notNull(),
  method: text("method").notNull(),
  track: text("track").notNull(),
  guardianUserId: text("guardian_user_id"),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
  consentId: bigint("consent_id", { mode: "number" }).notNull(),
});
