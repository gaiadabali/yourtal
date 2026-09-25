import { text, timestamp } from "drizzle-orm/pg-core";
import { identityPgSchema } from "./identity-schema";

/**
 * `identity.staff_role` (1.5.b, migration 20260926000000). `yourtal_app`
 * holds SELECT only — every row is written by `pnpm staff:add` against the
 * owner connection.
 */
export const staffRoles = identityPgSchema.table("staff_role", {
  userId: text("user_id").notNull(),
  role: text("role").notNull(),
  grantedBy: text("granted_by").notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
});
