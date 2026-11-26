import { boolean, integer, text, timestamp } from "drizzle-orm/pg-core";
import { spambankPgSchema } from "./spambank-schema";

/** `spambank.control`: a singleton row (the kill-switch pause and the daily cap). Update only. */
export const controls = spambankPgSchema.table("control", {
  id: boolean("id").primaryKey().default(true),
  dailyCap: integer("daily_cap").notNull().default(200),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  pausedReason: text("paused_reason"),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});
