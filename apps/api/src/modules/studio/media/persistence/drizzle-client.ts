import { drizzle } from "drizzle-orm/node-postgres";
import { createPool } from "../../../../shared/persistence/create-pool";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export type StudioMediaDb = NodePgDatabase;

/** Same shape as `business/persistence/drizzle-client.ts` — see that file's doc comment. */
export function createStudioMediaDb(databaseUrl: string): StudioMediaDb {
  const pool = createPool(databaseUrl);
  return drizzle(pool);
}
