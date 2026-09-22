import { bigint, boolean, integer, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { storePgSchema } from "./store-schema";

/**
 * `store.listings`, as the migrations define it.
 *
 * `lifecycleState` and `perUserLimit` are NOT on `listingSchema`
 * (`@yourtal/contracts/listing`) — see
 * `packages/db/migrations/20260920040000_store_listing_management.sql`'s
 * header and `packages/contracts/src/db-drift/schema-drift.test.ts`'s
 * exemption for `lifecycle_state`. `perUserLimit` IS on the contract
 * (added alongside this table); it is listed explicitly here anyway so a
 * reader does not have to cross-check the migration to find it.
 *
 * `priceInPoints` is written once, at creation, from whatever the caller
 * supplies (today: mock-derived at seed time). This module never
 * RECOMPUTES it — see `drizzle-listing.repository.ts`'s `updateSettlementValue`.
 */
export const listings = storePgSchema.table("listings", {
  // NO `.defaultRandom()`: the migration declares `id uuid PRIMARY KEY` with
  // no DB-side default (unlike `business_accounts.id`), so callers must
  // generate one explicitly. See `DrizzleListingRepository.create`.
  id: uuid("id").primaryKey(),
  merchantId: uuid("merchant_id").notNull(),
  merchantName: text("merchant_name").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  // YT-0513: one currency per listing, stated rather than implied by a
  // column name. See the migration for why there is no DEFAULT.
  currency: text("currency").notNull(),
  faceValueMinor: bigint("face_value_minor", { mode: "number" }).notNull(),
  settlementValueMinor: bigint("settlement_value_minor", { mode: "number" }).notNull(),
  priceInPoints: bigint("price_in_points", { mode: "number" }).notNull(),
  stockRemaining: integer("stock_remaining").notNull(),
  stockTotal: integer("stock_total").notNull(),
  transferable: boolean("transferable").notNull(),
  partialRedemptionPolicy: text("partial_redemption_policy").notNull(),
  minimumSpendMinor: bigint("minimum_spend_minor", { mode: "number" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  status: text("status").notNull(),
  /** MERCHANT-side visibility. Never served to a customer. See the repository. */
  lifecycleState: text("lifecycle_state").notNull().default("active"),
  perUserLimit: integer("per_user_limit"),
});

export const merchantLocations = storePgSchema.table("merchant_location", {
  // Same as `listings.id`: no DB-side default in the migration.
  id: uuid("id").primaryKey(),
  merchantId: uuid("merchant_id").notNull(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  district: text("district").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const listingLocations = storePgSchema.table(
  "listing_location",
  {
    listingId: uuid("listing_id").notNull(),
    locationId: uuid("location_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.listingId, table.locationId] })],
);
