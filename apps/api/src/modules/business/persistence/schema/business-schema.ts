import { pgSchema } from "drizzle-orm/pg-core";

/**
 * One Postgres schema per Nest module, one DB role to match (docs/13b
 * section 7, docs/15). Every table in this module lives under `business` —
 * campaign, store and merchant modules get their own schemas when they
 * arrive, never a shared `public` table.
 *
 * Applied by `packages/db/migrations/20260919000003_business.sql`
 * (YT-0518), hand-written rather than generated from this file — see that
 * migration's header for why the migration, not this schema, is the source
 * of truth where the two could disagree.
 */
export const businessPgSchema = pgSchema("business");
