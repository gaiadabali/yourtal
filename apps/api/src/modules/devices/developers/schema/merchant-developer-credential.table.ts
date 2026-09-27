import { boolean, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { businessPgSchema } from "../../../business/persistence/schema/business-schema";

/** `business.merchant_developer_credential` — see the migration's own comment for why this table exists at all. */
export const merchantDeveloperCredentials = businessPgSchema.table(
  "merchant_developer_credential",
  {
    credentialId: text("credential_id").primaryKey(),
    businessId: uuid("business_id").notNull(),
    label: text("label").notNull(),
    sandbox: boolean("sandbox").notNull().default(true),
    state: text("state").notNull().default("active"),
    issuedBy: text("issued_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);
