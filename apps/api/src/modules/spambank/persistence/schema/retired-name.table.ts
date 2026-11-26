import { text, timestamp } from "drizzle-orm/pg-core";
import { spambankPgSchema } from "./spambank-schema";

/** `spambank.retired_name`: a name that was ever given out. Insert-only for the app. */
export const retiredNames = spambankPgSchema.table("retired_name", {
  localPart: text("local_part").primaryKey(),
  retiredAt: timestamp("retired_at", { withTimezone: true }).notNull().defaultNow(),
});
