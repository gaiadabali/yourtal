import { pgSchema } from "drizzle-orm/pg-core";

/**
 * The `spambank` Postgres schema (BUILD.md section 6), created by
 * `packages/db/migrations/20261128090000_spambank.sql`. The migration is the
 * source of truth for constraints, triggers, row-level security and grants;
 * these table objects only describe the columns the module reads and writes.
 */
export const spambankPgSchema = pgSchema("spambank");
