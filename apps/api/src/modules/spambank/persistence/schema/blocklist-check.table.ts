import { bigserial, text, timestamp } from "drizzle-orm/pg-core";
import { spambankPgSchema } from "./spambank-schema";

/** `spambank.blocklist_check`: one row per target per daily DNS blocklist lookup. */
export const blocklistChecks = spambankPgSchema.table("blocklist_check", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  target: text("target").notNull(),
  list: text("list").notNull(),
  result: text("result").$type<"clean" | "listed" | "refused" | "error">().notNull(),
  detail: text("detail"),
});
