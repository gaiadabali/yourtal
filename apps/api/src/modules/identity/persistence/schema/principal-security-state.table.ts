import { text, timestamp } from "drizzle-orm/pg-core";
import { identityPgSchema } from "./identity-schema";

/**
 * Backs `AsyncPrincipalResolver.resolve()` (YT-0582). One row per user who
 * has ever had security state set; a user with no row has never been
 * frozen, which is the correct default (docs/14 section 5) — see the
 * migration's header for why `valueFrozenUntil` stays nullable rather than
 * defaulted.
 */
export const principalSecurityState = identityPgSchema.table("principal_security_state", {
  userId: text("user_id").primaryKey(),
  valueFrozenUntil: timestamp("value_frozen_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
