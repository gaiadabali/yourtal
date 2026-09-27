import { customType, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { businessPgSchema } from "../../../business/persistence/schema/business-schema";

/** Drizzle has no built-in `bytea` mapping; a thin passthrough to `Buffer`, same shape node-postgres already returns `bytea` as. */
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/** `business.webhook_subscription` — TASKS.md 8.3.c. Delivery itself reuses `@yourtal/drivers`'s existing webhook boundary; see the migration's own comment. */
export const webhookSubscriptions = businessPgSchema.table("webhook_subscription", {
  businessId: uuid("business_id").primaryKey(),
  url: text("url").notNull(),
  secretCiphertext: bytea("secret_ciphertext").notNull(),
  secretNonce: bytea("secret_nonce").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
