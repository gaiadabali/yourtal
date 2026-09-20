import { bigint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { storePgSchema } from "./store-schema";

/**
 * `store.listing_price_revision` — the audit trail for every settlement-value
 * change (docs/17 section 2.1). See the migration
 * (`20260920040000_store_listing_management.sql`) for why
 * `newPriceInPoints` is nullable: this module cannot compute a real points
 * price without the ledger's backing rate, which `yourtal_app` has no grant
 * to read at all.
 */
export const listingPriceRevisions = storePgSchema.table("listing_price_revision", {
  id: uuid("id").primaryKey().defaultRandom(),
  listingId: uuid("listing_id").notNull(),
  previousSettlementValueIdr: bigint("previous_settlement_value_idr", {
    mode: "number",
  }).notNull(),
  newSettlementValueIdr: bigint("new_settlement_value_idr", { mode: "number" }).notNull(),
  previousPriceInPoints: bigint("previous_price_in_points", { mode: "number" }).notNull(),
  /** NULL until the ledger's pricing engine closes this seam. Never set by this module. */
  newPriceInPoints: bigint("new_price_in_points", { mode: "number" }),
  requestedBy: uuid("requested_by").notNull(),
  reason: text("reason"),
  /**
   * NULL for a direct (non-material) edit. Set to the originating row's id
   * when this revision is the result of an approved
   * `store.settlement_decrease_request` (YT-0575) — see
   * `apply-settlement-value-change.ts`, the one function that writes this
   * table for either path.
   */
  settlementDecreaseRequestId: uuid("settlement_decrease_request_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
