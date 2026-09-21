import { pgSchema } from "drizzle-orm/pg-core";

/**
 * One Postgres schema per Nest module (docs/13b section 7, docs/15).
 *
 * `identity` is new as of YT-0582 — the first table for principal-level
 * security state that is not scoped to a business. Applied by
 * `packages/db/migrations/20260921130000_principal_security_state.sql`,
 * hand-written rather than generated from this file; see that migration's
 * header for why it, not this file, is the source of truth where the two
 * could disagree.
 */
export const identityPgSchema = pgSchema("identity");
