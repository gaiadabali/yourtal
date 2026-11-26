import { boolean, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { spambankPgSchema } from "./spambank-schema";

/**
 * `spambank.mailbox`: one mailbox per YourTal account, never renamed. The
 * `local_part` format check, the retired-name trigger and the region wall live
 * in the migration. `status` is `provisioning | active | suspended | erasing`.
 */
export const mailboxes = spambankPgSchema.table("mailbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().unique(),
  region: text("region").$type<"AU" | "ID">().notNull(),
  localPart: text("local_part").notNull().unique(),
  domain: text("domain").notNull(),
  stalwartAccountId: text("stalwart_account_id").unique(),
  junkMailboxId: text("junk_mailbox_id"),
  status: text("status").$type<"provisioning" | "active" | "suspended" | "erasing">().notNull(),
  enabledVia: text("enabled_via").$type<"yourtal" | "snapapp" | "ftr">().notNull(),
  statementsToSnapapp: boolean("statements_to_snapapp").notNull().default(false),
  newMailAlerts: boolean("new_mail_alerts").notNull().default(true),
  emailState: text("email_state"),
  lastIngestedAt: timestamp("last_ingested_at", { withTimezone: true }),
  lastAlertAt: timestamp("last_alert_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
