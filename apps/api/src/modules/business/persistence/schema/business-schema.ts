import { pgSchema } from "drizzle-orm/pg-core";

/**
 * One Postgres schema per Nest module, one DB role to match (docs/13b
 * section 7, docs/15). Every table in this module lives under `business` —
 * campaign, store and merchant modules get their own schemas when they
 * arrive, never a shared `public` table.
 *
 * Not yet applied anywhere: YT-0022 has not provisioned Postgres, so no
 * migration has been generated from this. See the ticket report.
 */
export const businessPgSchema = pgSchema("business");
