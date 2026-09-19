import { text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { BusinessMember } from "@yourtal/contracts/business/member";
import { businessAccounts } from "./business-account.table";
import { businessPgSchema } from "./business-schema";

export const businessMembers = businessPgSchema.table(
  "business_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businessAccounts.id),
    userId: text("user_id").notNull(),
    role: text("role").notNull().$type<BusinessMember["role"]>(),
    invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
    invitedByUserId: text("invited_by_user_id").notNull(),
    /** `null` until the invitee accepts; the owner's row is joined at creation. */
    joinedAt: timestamp("joined_at", { withTimezone: true }),
  },
  (table) => [
    // One membership row per person per business (docs/17 section 2.1).
    uniqueIndex("business_members_business_id_user_id_key").on(table.businessId, table.userId),
  ],
);
