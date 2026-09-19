import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export type BusinessDb = NodePgDatabase;

/**
 * Only called when `AppConfig.databaseUrl` is set — see `business.module.ts`.
 * UNTESTED: YT-0022 has not provisioned Postgres, so nothing in this file
 * has run against a real database. It typechecks against the Drizzle/`pg`
 * APIs and nothing more; treat it as reviewed-but-unverified.
 */
export function createBusinessDb(databaseUrl: string): BusinessDb {
  const pool = new Pool({ connectionString: databaseUrl });
  return drizzle(pool);
}
