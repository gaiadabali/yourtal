import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/**
 * The one Drizzle handle every module shares. YT-0553.
 *
 * Each module still owns its own Postgres schema and its own tables
 * (`business`, `campaign`, `watch`) — that separation is the point of
 * docs/13b §7. What they do not each need is their own copy of "make a pool
 * and wrap it in Drizzle", which is how `createBusinessDb` and a
 * `createCampaignDb` would have ended up as two places to fix a pool
 * setting.
 *
 * Exercised against real Postgres since YT-0552. It used to carry a note
 * saying nothing in it had ever run against a database, which was true when
 * written and is not any more.
 */
export type AppDb = NodePgDatabase;

export function createAppDb(databaseUrl: string): AppDb {
  return drizzle(new Pool({ connectionString: databaseUrl }));
}
