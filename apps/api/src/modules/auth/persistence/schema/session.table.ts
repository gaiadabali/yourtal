import { text, timestamp } from "drizzle-orm/pg-core";
import { authIdentityPgSchema } from "./auth-identity-schema";

/**
 * `identity.session`. `id` is the SHA-256 hex digest of the opaque CSPRNG
 * token handed to the caller — see `crypto/opaque-token.ts` — never the
 * token itself. No `isExpired`/`isActive` column: see the migration's
 * header for why expiry and revocation are read from
 * `absoluteExpiresAt`/`revokedAt` directly rather than from a derived flag.
 */
export const sessions = authIdentityPgSchema.table("session", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  absoluteExpiresAt: timestamp("absolute_expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});
