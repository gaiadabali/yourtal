import { text, timestamp, uuid } from "drizzle-orm/pg-core";
import { businessAccounts } from "./business-account.table";
import { businessPgSchema } from "./business-schema";

/** One billing contact per business for now — a list is a later ticket if a business asks for more than one. */
export const billingContacts = businessPgSchema.table("billing_contacts", {
  businessId: uuid("business_id")
    .primaryKey()
    .references(() => businessAccounts.id),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
