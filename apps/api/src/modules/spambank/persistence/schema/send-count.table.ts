import { date, integer, primaryKey, uuid } from "drizzle-orm/pg-core";
import { mailboxes } from "./mailbox.table";
import { spambankPgSchema } from "./spambank-schema";

/** `spambank.send_count`: recipients a mailbox has sent to per UTC day (the 100-a-day cap). */
export const sendCounts = spambankPgSchema.table(
  "send_count",
  {
    mailboxId: uuid("mailbox_id")
      .notNull()
      .references(() => mailboxes.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    recipients: integer("recipients").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.mailboxId, table.day] })],
);
