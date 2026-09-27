import { boolean, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { Business } from "@yourtal/contracts/business";
import { businessPgSchema } from "./business-schema";

export const businessAccounts = businessPgSchema.table("business_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  legalName: text("legal_name").notNull(),
  displayName: text("display_name").notNull(),
  // TASKS.md 7.1.a: ABN for AU; NIB or NPWP for ID. Which shape is valid for
  // which region is a CHECK in the migration, not just the Zod refine.
  taxIdKind: text("tax_id_kind").notNull(),
  taxIdValue: text("tax_id_value").notNull(),
  /** AU only; `null` for an ID business (migration CHECK enforces this). */
  addressState: text("address_state"),
  /** AU only; `null` for an ID business. */
  addressPostcode: text("address_postcode"),
  /** ID only; `null` for an AU business. */
  addressCity: text("address_city"),
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
