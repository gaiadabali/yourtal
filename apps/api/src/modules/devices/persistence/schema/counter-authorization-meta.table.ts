import { bigint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { storePgSchema } from "../../../store/persistence/schema/store-schema";

/** `store.counter_authorization_meta` — see the migration's own comment for what this is and is not. */
export const counterAuthorizationMeta = storePgSchema.table("counter_authorization_meta", {
  authorizationId: text("authorization_id").primaryKey(),
  deviceId: uuid("device_id").notNull(),
  businessId: uuid("business_id").notNull(),
  locationId: uuid("location_id").notNull(),
  orderRef: text("order_ref").notNull(),
  orderTotalMinor: bigint("order_total_minor", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
