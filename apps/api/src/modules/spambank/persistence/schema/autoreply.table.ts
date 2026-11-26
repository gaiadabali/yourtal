import { text, timestamp, uuid } from "drizzle-orm/pg-core";
import { mailboxes } from "./mailbox.table";
import { spambankPgSchema } from "./spambank-schema";

/** `spambank.autoreply`: one row per counter-spam reply sent (or queued, or failed). */
export const autoreplies = spambankPgSchema.table("autoreply", {
  id: uuid("id").primaryKey(),
  orgDomain: text("org_domain").notNull(),
  toAddress: text("to_address").notNull(),
  sourceMailboxId: uuid("source_mailbox_id").references(() => mailboxes.id, {
    onDelete: "set null",
  }),
  sourceEmailId: text("source_email_id"),
  messageId: text("message_id").notNull().unique(),
  mode: text("mode").$type<"redirect" | "live">().notNull(),
  status: text("status")
    .$type<"queued" | "sent" | "send_failed" | "bounced" | "complained">()
    .notNull(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});
