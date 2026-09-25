import { jsonb, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * `platform` holds tables more than one module writes or reads
 * (`platform.idempotency`, `platform.sim_outbox`) — this is why
 * `region_setting` lives here rather than under any one domain schema
 * (1.2.f's own migration header).
 */
const platformPgSchema = pgSchema("platform");

/**
 * Read-only mirror of `platform.region_setting`
 * (`packages/db/migrations/20260925193000_platform_region_setting.sql`).
 * `apps/api/src/shared/settings` only ever SELECTs through this — proposing
 * and approving a change is `ledger-internal`'s `proposeSetting` /
 * `approveSetting` (1.2.f), fronted by 9.5.d's staff console, not this
 * reader.
 */
export const regionSettings = platformPgSchema.table("region_setting", {
  id: uuid("id").primaryKey().defaultRandom(),
  region: text("region").notNull(),
  key: text("key").notNull(),
  value: jsonb("value").notNull(),
  setBy: text("set_by").notNull(),
  approvedBy: text("approved_by"),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
