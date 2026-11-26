import { boolean, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { mailboxes } from "./mailbox.table";
import { spambankPgSchema } from "./spambank-schema";

/** `spambank.ingested_message`: ingest idempotency and the auto-reply decision; purged after 30 days. */
export const ingestedMessages = spambankPgSchema.table(
  "ingested_message",
  {
    mailboxId: uuid("mailbox_id")
      .notNull()
      .references(() => mailboxes.id, { onDelete: "cascade" }),
    emailId: text("email_id").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    folder: text("folder").$type<"inbox" | "spam" | "junk" | "other">().notNull(),
    bulk: boolean("bulk").notNull(),
    dmarcPass: boolean("dmarc_pass").notNull(),
    fromOrgDomain: text("from_org_domain"),
    autoreplyDecision: text("autoreply_decision").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.mailboxId, table.emailId] })],
);
