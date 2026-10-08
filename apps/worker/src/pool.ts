import { Pool } from "pg";
import type { PoolConfig } from "pg";

/**
 * Every `pg.Pool` the worker opens goes through here. A pool re-emits an
 * error on an idle client (Postgres restarted, the connection was cut) as
 * `error` on itself, and an `error` event with no listener is thrown by Node
 * and kills the process. The pool already drops the dead client and opens a
 * fresh one on the next query, so all that is left to do is log. 13.3.t.
 */
export function createPool(
  connectionString: string,
  options: PoolConfig = {},
  log: (message: string) => void = (message) => {
    console.error(message);
  },
): Pool {
  const pool = new Pool({ ...options, connectionString });
  pool.on("error", (error: Error) => {
    log(`[worker] idle Postgres client failed; the pool will reconnect: ${error.message}`);
  });
  return pool;
}
