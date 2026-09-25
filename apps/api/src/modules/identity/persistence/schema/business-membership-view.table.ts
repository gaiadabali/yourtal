import { pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * A READ-ONLY mirror of `business.business_members`' three columns
 * `GET /api/me` (1.4.d) needs for its `businessMemberships` list.
 *
 * Declared here rather than imported from
 * `apps/api/src/modules/business/**` — Area C's own files, out of this
 * task's write set. This is the same "declared twice, no coupling"
 * precedent `auth/persistence/schema/auth-identity-schema.ts` already sets
 * for the `identity` schema: `20260919000003_business.sql` is the source of
 * truth either way, and two independent Drizzle objects pointed at the same
 * real table compile to identical SQL — there is nothing to keep "in sync".
 *
 * Read-only by construction: no INSERT/UPDATE/DELETE anywhere in this
 * module touches it, and `yourtal_app`'s grants on the real table remain
 * the business module's to manage.
 */
const businessSchema = pgSchema("business");

export const businessMembershipsView = businessSchema.table("business_members", {
  businessId: uuid("business_id").notNull(),
  userId: text("user_id").notNull(),
  role: text("role").notNull(),
  joinedAt: timestamp("joined_at", { withTimezone: true }),
});
