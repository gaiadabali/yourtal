import { integer, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { mailboxes } from "./mailbox.table";
import { spambankPgSchema } from "./spambank-schema";

/** `spambank.unsubscribe`: one row per one-tap unsubscribe (feeds the marketers-unsubscribed counter). */
export const unsubscribes = spambankPgSchema.table("unsubscribe", {
  id: uuid("id").primaryKey(),
  mailboxId: uuid("mailbox_id")
    .notNull()
    .references(() => mailboxes.id, { onDelete: "cascade" }),
  orgDomain: text("org_domain").notNull(),
  method: text("method").$type<"one_click" | "mailto" | "link">().notNull(),
  status: text("status").$type<"done" | "failed" | "opened">().notNull(),
  httpStatus: integer("http_status"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
