import { integer, text, timestamp } from "drizzle-orm/pg-core";
import { spambankPgSchema } from "./spambank-schema";

/**
 * `spambank.autoreply_domain`: the per-domain throttle and opt-out (D2 3, 5).
 * Global, not regional: it protects one sending reputation. Never deleted from.
 */
export const autoreplyDomains = spambankPgSchema.table("autoreply_domain", {
  orgDomain: text("org_domain").primaryKey(),
  lastRepliedAt: timestamp("last_replied_at", { withTimezone: true }),
  optedOutAt: timestamp("opted_out_at", { withTimezone: true }),
  repliesTotal: integer("replies_total").notNull().default(0),
});
