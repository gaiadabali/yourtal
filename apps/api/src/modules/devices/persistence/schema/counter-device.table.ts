import { integer, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { storePgSchema } from "../../../store/persistence/schema/store-schema";

/**
 * `store.counter_device` (TASKS.md 8.1.a, migration
 * `20260927023755_counter_devices.sql`). Lives under the `store` schema
 * (docs/15: schema per domain) but is owned and read by THIS module, not
 * `store` — the same cross-schema-import shape
 * `store/persistence/drizzle-business-region-lookup.ts` already uses for
 * `business.business_accounts`.
 */
export const counterDevices = storePgSchema.table("counter_device", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull(),
  region: text("region").notNull(),
  locationId: uuid("location_id").notNull(),
  label: text("label").notNull(),
  pinHash: text("pin_hash").notNull(),
  credentialHash: text("credential_hash"),
  pairingCodeHash: text("pairing_code_hash").notNull(),
  pairingExpiresAt: timestamp("pairing_expires_at", { withTimezone: true }).notNull(),
  pairedAt: timestamp("paired_at", { withTimezone: true }),
  failedPinAttempts: integer("failed_pin_attempts").notNull().default(0),
  pinLockedUntil: timestamp("pin_locked_until", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedBy: text("revoked_by"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
