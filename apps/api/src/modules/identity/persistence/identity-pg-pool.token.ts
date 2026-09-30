import type pg from "pg";

/**
 * A raw `pg.Pool`, distinct from this module's Drizzle `AppDb` handle
 * (`IDENTITY_DB`) -- same reason `me.tokens.ts`'s own `MePgPool` exists:
 * `@yourtal/db`'s `postgresHandlers` (the DSAR deletion handlers) takes a
 * `pg.Pool` directly. `delete-guardian-account.use-case.ts` (12.4.b #6) is
 * this module's own caller.
 */
export type IdentityPgPool = pg.Pool;
export const IDENTITY_PG_POOL = Symbol("IDENTITY_PG_POOL");
