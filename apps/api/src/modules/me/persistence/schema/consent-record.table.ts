import { bigserial, text, timestamp } from "drizzle-orm/pg-core";
import { identityPgSchema } from "../../../identity/persistence/schema/identity-schema";

/**
 * `identity.consent_record` (5.4.a) — shaped like `@yourtal/consent`'s
 * `consentRecordSchema`. Reuses `identityPgSchema` (identity module's own
 * schema builder) rather than declaring a second `pgSchema("identity")`:
 * Drizzle table objects from either file bind to the same Postgres schema,
 * and a second builder object would just be a second name for one thing.
 * Applied by `packages/db/migrations/20260926020000_me_schema.sql`.
 */
export const consentRecords = identityPgSchema.table("consent_record", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: text("user_id").notNull(),
  purpose: text("purpose").notNull(),
  jurisdiction: text("jurisdiction").notNull(),
  policyVersionId: text("policy_version_id").notNull(),
  state: text("state").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  source: text("source").notNull(),
});
