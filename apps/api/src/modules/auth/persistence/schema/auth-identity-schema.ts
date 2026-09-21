import { pgSchema } from "drizzle-orm/pg-core";

/**
 * A SEPARATE reference to the same `identity` Postgres schema
 * `apps/api/src/modules/identity/persistence/schema/identity-schema.ts`
 * already declares for `principal_security_state`.
 *
 * Not imported from there, deliberately: `apps/api/src/modules/identity/**`
 * is YT-0582's, out of this ticket's write set, and is not to be touched.
 * `pgSchema("identity")` called twice, once per module, produces two
 * distinct Drizzle objects that both compile to the identical `identity.`
 * prefix in the SQL they generate — there is nothing to keep "in sync"
 * between them, because neither is the source of truth. The migrations are
 * (this file's own tables are applied by
 * `packages/db/migrations/20260921180000_auth_credential_session_verification_token.sql`,
 * hand-written, exactly as `identity-schema.ts`'s own header explains for
 * its table).
 *
 * `apps/api/src/modules/watch/checkpoint/persistence/checkpoint-nonce.table.ts`
 * already sets this precedent for the same reason (a ticket at `review`
 * awaiting a verifier, there; a fenced sibling module, here) — see that
 * file's header.
 */
export const authIdentityPgSchema = pgSchema("identity");
