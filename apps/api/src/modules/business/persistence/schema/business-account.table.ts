import { boolean, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { Business } from "@yourtal/contracts/business";
import { businessPgSchema } from "./business-schema";

export const businessAccounts = businessPgSchema.table("business_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  legalName: text("legal_name").notNull(),
  displayName: text("display_name").notNull(),
  district: text("district").notNull(),
  /** `advertiser`/`supplier`/`redeemer` subset — parsed via `businessRoleSchema` on read (13b section 3). */
  roles: jsonb("roles").$type<Business["roles"]>().notNull(),
  isVerified: boolean("is_verified").notNull().default(false),
  logoUrl: text("logo_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  // TASKS.md 1.1.a. `region` is set once at onboarding and never changed
  // after — see businessSchema's own comment.
  region: text("region").notNull(),
  currency: text("currency").notNull(),
  handle: text("handle").notNull(),
  coverUrl: text("cover_url"),
});
