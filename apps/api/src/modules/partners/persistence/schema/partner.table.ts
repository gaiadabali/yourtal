import { pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * `platform` (not this module's own schema): more than one module could
 * plausibly need a partner concept later — same reasoning
 * `platform.sim_outbox`/`platform.region_setting` already give for living
 * there. A second `pgSchema("platform")` call here, not an import of
 * `apps/api/src/shared/settings/region-setting.table.ts`'s (Area A's file)
 * — Drizzle only needs the schema NAME to match, and two declarations of
 * the same schema naming different tables is exactly what that file itself
 * already does relative to `platform.sim_outbox`'s own declaration.
 */
const platformPgSchema = pgSchema("platform");

/**
 * TASKS.md 8.4.d (F73): `secretEnvVar` names the env var that holds this
 * partner's actual HMAC key — never the key itself. See the migration
 * that added it (20260928143835) for why a reference, not a hash or a
 * sealed value.
 */
export const partnerCredentials = platformPgSchema.table("partner_credential", {
  partnerId: text("partner_id").primaryKey(),
  secretEnvVar: text("secret_env_var").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const partnerReceipts = platformPgSchema.table("partner_receipt", {
  partnerId: text("partner_id").notNull(),
  receiptHash: text("receipt_hash").notNull(),
  userId: uuid("user_id").notNull(),
  externalRef: text("external_ref").notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
});
