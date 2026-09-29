import { text, timestamp } from "drizzle-orm/pg-core";
import { identityPgSchema } from "./identity-schema";

/**
 * `identity.guardian_consent` (12.1.a) — one row per teen account, created
 * at registration alongside its `identity.user_profile` row. See the
 * migration's header for why there is no stored `status` column:
 * `approvedAt`/`revokedAt` are the facts, derived into a status at read
 * time (`guardianConsentStatusOf` in the repository interface).
 */
export const guardianConsents = identityPgSchema.table("guardian_consent", {
  userId: text("user_id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  guardianEmail: text("guardian_email").notNull(),
  // Immutable after creation, same convention as user_profile.region.
  region: text("region").notNull(),
  guardianConfirmedAdultAt: timestamp("guardian_confirmed_adult_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
