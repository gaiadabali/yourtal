import type pg from "pg";

/**
 * A raw `pg.Pool`, distinct from this module's Drizzle `AppDb` handle.
 * `@yourtal/db`'s `postgresHandlers` (the DSAR deletion handlers, A's file)
 * takes a `pg.Pool` directly rather than a Drizzle wrapper — see
 * `account.controller.ts` for where it is used.
 */
export type MePgPool = pg.Pool;
export const ME_PG_POOL = Symbol("ME_PG_POOL");
