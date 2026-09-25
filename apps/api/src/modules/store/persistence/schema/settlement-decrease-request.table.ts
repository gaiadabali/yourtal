import { bigint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { storePgSchema } from "./store-schema";

/**
 * `store.settlement_decrease_request` (YT-0575) — the two-person-approval
 * workflow `policies/resource_policies/listing.yaml`'s
 * `approve_settlement_decrease` rule has always anticipated and nothing
 * built until now. See the migration
 * (`20260920065723_settlement_decrease_requests.sql`) for the CHECK
 * constraints that make a self-approved or non-decreasing row
 * unrepresentable, not merely rejected by application code.
 *
 * `state` is `"pending" | "approved"` — there is no `"rejected"` here; that
 * is out of this pass's scope (see the ticket report).
 */
export const settlementDecreaseRequests = storePgSchema.table("settlement_decrease_request", {
  id: uuid("id").primaryKey().defaultRandom(),
  listingId: uuid("listing_id").notNull(),
  currency: text("currency").notNull(),
  requestedBy: uuid("requested_by").notNull(),
  currentSettlementValueMinor: bigint("current_settlement_value_minor", {
    mode: "number",
  }).notNull(),
  proposedSettlementValueMinor: bigint("proposed_settlement_value_minor", {
    mode: "number",
  }).notNull(),
  reason: text("reason"),
  /** `"pending" | "approved"` — enforced by the migration's CHECK, not re-typed here. */
  state: text("state").notNull().default("pending"),
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
