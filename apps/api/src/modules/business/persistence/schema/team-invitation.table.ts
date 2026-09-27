import { text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { GrantableRole } from "../business-member.repository";
import { businessAccounts } from "./business-account.table";
import { businessPgSchema } from "./business-schema";

/** TASKS.md 7.1.c: an email invite, keyed by a hashed token rather than a userId the invitee may not have yet. */
export const teamInvitations = businessPgSchema.table("team_invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businessAccounts.id),
  email: text("email").notNull(),
  role: text("role").notNull().$type<GrantableRole>(),
  tokenHash: text("token_hash").notNull(),
  invitedByUserId: text("invited_by_user_id").notNull(),
  invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  acceptedByUserId: text("accepted_by_user_id"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});
