import {
  bigserial,
  boolean,
  date,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * `me` — declared interests, follows, saves, linked-app codes, streak state
 * and notifications (5.4/5.5). Applied by
 * `packages/db/migrations/20260926020000_me_schema.sql`.
 */
export const mePgSchema = pgSchema("me");

export const interests = mePgSchema.table("interest", {
  userId: text("user_id").notNull(),
  nodeId: text("node_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const follows = mePgSchema.table("follow", {
  userId: text("user_id").notNull(),
  businessId: uuid("business_id").notNull(),
  region: text("region").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const saves = mePgSchema.table("save", {
  userId: text("user_id").notNull(),
  campaignId: uuid("campaign_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const linkCodes = mePgSchema.table("link_code", {
  code: text("code").primaryKey(),
  userId: text("user_id").notNull(),
  region: text("region").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
});

export const streakStates = mePgSchema.table("streak_state", {
  userId: text("user_id").primaryKey(),
  region: text("region").notNull(),
  currentLength: integer("current_length").notNull(),
  lastCountedDate: date("last_counted_date", { mode: "string" }),
  day3Granted: boolean("day3_granted").notNull(),
  day7Granted: boolean("day7_granted").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notifications = mePgSchema.table("notification", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: text("user_id").notNull(),
  region: text("region").notNull(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp("read_at", { withTimezone: true }),
});

export const notificationPreferences = mePgSchema.table("notification_preference", {
  userId: text("user_id").notNull(),
  category: text("category").notNull(),
  pushEnabled: boolean("push_enabled").notNull(),
});
