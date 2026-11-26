import { foreignKey, integer, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { leads } from "./lead.table";
import { mailboxes } from "./mailbox.table";
import { spambankPgSchema } from "./spambank-schema";

/** `spambank.lead_sighting`: which mailbox saw which brand (the "recipients" count). */
export const leadSightings = spambankPgSchema.table(
  "lead_sighting",
  {
    region: text("region").$type<"AU" | "ID">().notNull(),
    orgDomain: text("org_domain").notNull(),
    mailboxId: uuid("mailbox_id")
      .notNull()
      .references(() => mailboxes.id, { onDelete: "cascade" }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    messages: integer("messages").notNull().default(1),
  },
  (table) => [
    primaryKey({ columns: [table.region, table.orgDomain, table.mailboxId] }),
    foreignKey({
      columns: [table.region, table.orgDomain],
      foreignColumns: [leads.region, leads.orgDomain],
    }).onDelete("cascade"),
  ],
);
