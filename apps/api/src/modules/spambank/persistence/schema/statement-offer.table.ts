import { integer, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { mailboxes } from "./mailbox.table";
import { spambankPgSchema } from "./spambank-schema";

/** `spambank.statement_offer`: an attachment offered to SnapApp, and what SnapApp did with it. */
export const statementOffers = spambankPgSchema.table(
  "statement_offer",
  {
    mailboxId: uuid("mailbox_id")
      .notNull()
      .references(() => mailboxes.id, { onDelete: "cascade" }),
    emailId: text("email_id").notNull(),
    blobId: text("blob_id").notNull(),
    name: text("name"),
    type: text("type").notNull(),
    size: integer("size").notNull(),
    offeredAt: timestamp("offered_at", { withTimezone: true }).notNull().defaultNow(),
    outcome: text("outcome").$type<"imported" | "duplicate" | "failed" | "skipped">(),
    outcomeAt: timestamp("outcome_at", { withTimezone: true }),
    detail: text("detail"),
  },
  (table) => [primaryKey({ columns: [table.mailboxId, table.emailId, table.blobId] })],
);
