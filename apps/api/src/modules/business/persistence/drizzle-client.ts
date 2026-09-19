import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export type BusinessDb = NodePgDatabase;

/**
 * `AppConfig.databaseUrl` for the running app (see `business.module.ts`);
 * `TEST_DATABASE_URL` or the `yourtal_app` role for tests (see
 * `business-db.test-helper.ts`). Postgres is provisioned as of YT-0552 and
 * every repository built on this pool has been exercised against it — see
 * the individual repository files and `drizzle-business-onboarding.unit-of-work.test.ts`.
 */
export function createBusinessDb(databaseUrl: string): BusinessDb {
  const pool = new Pool({ connectionString: databaseUrl });
  return drizzle(pool);
}
