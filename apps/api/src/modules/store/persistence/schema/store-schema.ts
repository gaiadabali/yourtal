import { pgSchema } from "drizzle-orm/pg-core";

/**
 * One Postgres schema per Nest module (docs/13b section 7, docs/15). Every
 * table this module owns lives under `store` — applied by
 * `packages/db/migrations/20260919000004_catalogue.sql` (YT-0519),
 * `..._merchant_locations.sql` (YT-0502) and
 * `..._store_listing_management.sql` (this module's own migration).
 *
 * Hand-written migrations are the source of truth where they and this file
 * could disagree — see the catalogue migration's header for why.
 */
export const storePgSchema = pgSchema("store");
