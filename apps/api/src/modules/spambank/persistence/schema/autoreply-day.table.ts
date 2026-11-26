import { date, integer } from "drizzle-orm/pg-core";
import { spambankPgSchema } from "./spambank-schema";

/**
 * `spambank.autoreply_day`: the global daily cap's counter and the bounce and
 * complaint tallies the auto-pause reads. `day` is the UTC date. A trigger in
 * the migration refuses any write that takes `sent` past `control.daily_cap`.
 */
export const autoreplyDays = spambankPgSchema.table("autoreply_day", {
  day: date("day", { mode: "string" }).primaryKey(),
  sent: integer("sent").notNull().default(0),
  bounces: integer("bounces").notNull().default(0),
  complaints: integer("complaints").notNull().default(0),
});
