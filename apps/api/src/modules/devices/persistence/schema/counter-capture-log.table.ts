import { bigint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { storePgSchema } from "../../../store/persistence/schema/store-schema";

/** `store.counter_capture_log` (TASKS.md 8.2.b/8.2.g) — this module's own audit trail, never a money source of truth. */
export const counterCaptureLog = storePgSchema.table("counter_capture_log", {
  captureId: text("capture_id").primaryKey(),
  deviceId: uuid("device_id").notNull(),
  businessId: uuid("business_id").notNull(),
  locationId: uuid("location_id").notNull(),
  voucherId: uuid("voucher_id").notNull(),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  currency: text("currency").notNull(),
  orderRef: text("order_ref").notNull(),
  orderTotalMinor: bigint("order_total_minor", { mode: "number" }).notNull(),
  authorizedAt: timestamp("authorized_at", { withTimezone: true }).notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
});
