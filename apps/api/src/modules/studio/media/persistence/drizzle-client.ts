import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export type StudioMediaDb = NodePgDatabase;

/** Same shape as `business/persistence/drizzle-client.ts` — see that file's doc comment. */
export function createStudioMediaDb(databaseUrl: string): StudioMediaDb {
  const pool = new Pool({ connectionString: databaseUrl });
  return drizzle(pool);
}
