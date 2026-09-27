import { integer, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { storePgSchema } from "./store-schema";

/** `store.voucher_batch_request` — see the migration for the two-person shape. */
export const voucherBatchRequests = storePgSchema.table("voucher_batch_request", {
  id: uuid("id").primaryKey(),
  listingId: uuid("listing_id").notNull(),
  merchantId: uuid("merchant_id").notNull(),
  quantity: integer("quantity").notNull(),
  requestedBy: uuid("requested_by").notNull(),
  reason: text("reason"),
  state: text("state").notNull().default("pending"),
  approvedBy: uuid("approved_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  mintedBatchId: uuid("minted_batch_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
