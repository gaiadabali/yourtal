import { boolean, integer, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { spambankPgSchema } from "./spambank-schema";

/** `spambank.lead`: a brand that mailed Spambank users, one list per region (never mixed). */
export const leads = spambankPgSchema.table(
  "lead",
  {
    region: text("region").$type<"AU" | "ID">().notNull(),
    orgDomain: text("org_domain").notNull(),
    displayName: text("display_name"),
    sampleFrom: text("sample_from"),
    sampleSubject: text("sample_subject"),
    hasListUnsubscribe: boolean("has_list_unsubscribe").notNull().default(false),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    messages: integer("messages").notNull().default(0),
    status: text("status")
      .$type<"new" | "contacted" | "ignored" | "customer">()
      .notNull()
      .default("new"),
    note: text("note"),
  },
  (table) => [primaryKey({ columns: [table.region, table.orgDomain] })],
);
