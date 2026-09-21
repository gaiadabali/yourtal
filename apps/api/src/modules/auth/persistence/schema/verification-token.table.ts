import { text, timestamp } from "drizzle-orm/pg-core";
import { authIdentityPgSchema } from "./auth-identity-schema";

/**
 * `identity.verification_token`. `id` is the SHA-256 hex digest of the
 * opaque token a caller presents in a reset link or a verification link —
 * see `crypto/opaque-token.ts`. `purpose` is constrained at the database
 * level (`CHECK (purpose IN ('password_reset', 'email_verification'))`);
 * Drizzle models the column as `text` here and the app-side union
 * (`VerificationPurpose` in `verification-token.repository.ts`) is what
 * TypeScript actually narrows against, matching how `checkpoint_nonce`'s
 * table file leaves its own DB-level CHECKs unmodelled.
 *
 * `consumedAt` — not deletion — is what makes a token single-use; see the
 * migration's header for why that distinction matters under replay.
 */
export const verificationTokens = authIdentityPgSchema.table("verification_token", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  purpose: text("purpose").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
