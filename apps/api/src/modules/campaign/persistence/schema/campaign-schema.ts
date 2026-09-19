import { pgSchema } from "drizzle-orm/pg-core";

/**
 * One Postgres schema per Nest module (docs/13b section 7, docs/15).
 *
 * Applied by `packages/db/migrations/20260919000004_catalogue.sql` and
 * extended by `20260920000012_campaign_lifecycle.sql`. The tables below are
 * Drizzle's view of migrations that already exist — this module does not
 * define the schema, it reads one.
 */
export const campaignPgSchema = pgSchema("campaign");
