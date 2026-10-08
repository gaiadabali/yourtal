import { Logger } from "@nestjs/common";
import { Pool } from "pg";
import type { PoolConfig } from "pg";

const logger = new Logger("PostgresPool");

/**
 * Every `pg.Pool` the api opens goes through here. A pool re-emits an error
 * on an idle client (Postgres restarted, the connection was cut, "Connection
 * terminated unexpectedly") as `error` on itself, and an `error` event with
 * no listener is thrown by Node and kills the process. The pool already
 * drops the dead client and opens a fresh one on the next query, so all that
 * is left to do is log. 13.3.t.
 */
export function createPool(connectionString: string, options: PoolConfig = {}): Pool {
  const pool = new Pool({ ...options, connectionString });
  pool.on("error", (error: Error) => {
    logger.error(`idle Postgres client failed; the pool will reconnect: ${error.message}`);
  });
  return pool;
}
