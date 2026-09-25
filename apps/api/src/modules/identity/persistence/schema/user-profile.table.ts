import { date, smallint, text, timestamp } from "drizzle-orm/pg-core";
import { identityPgSchema } from "./identity-schema";

/**
 * `identity.user_profile` (1.4.a) — the first canonical per-account row in
 * this schema. See the migration's header for why there is still no FK to a
 * "users" table.
 *
 * `age_band` is NOT a column here on purpose — it is computed at read time
 * from `date_of_birth` (`@yourtal/jurisdiction/age`), never stored.
 */
export const userProfiles = identityPgSchema.table("user_profile", {
  userId: text("user_id").primaryKey(),
  // Immutable after signup at the application layer — see the migration's
  // own comment. Nothing in this module ever includes this column in an
  // UPDATE.
  region: text("region").notNull(),
  displayLocale: text("display_locale").notNull().default("en-AU"),
  displayName: text("display_name").notNull(),
  dateOfBirth: date("date_of_birth", { mode: "string" }).notNull(),
  timezone: text("timezone").notNull(),
  guardianEmail: text("guardian_email"),
  parentConsentStatus: text("parent_consent_status").notNull().default("not_required"),
  trustTier: smallint("trust_tier").notNull().default(0),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
