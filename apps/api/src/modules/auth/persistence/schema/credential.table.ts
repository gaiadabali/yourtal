import { primaryKey, text, timestamp, unique } from "drizzle-orm/pg-core";
import { authIdentityPgSchema } from "./auth-identity-schema";

/**
 * `identity.credential` — one row per (user_id, kind). See the migration's
 * header for why `user_id` is an opaque UUID minted at registration
 * (`crypto.randomUUID()` in application code) rather than the email
 * address itself: `user_id` is the join key into stores whose grants
 * forbid DELETE and, for the ledger tables, UPDATE too, which makes an
 * email stored there unerasable and unchangeable. `identifier` is the
 * credential kind's own namespace value — the normalised email for
 * `kind = 'password'` — and the `UNIQUE (kind, identifier)` constraint
 * below, not the primary key, is what makes "this email is already
 * registered" a real constraint. There is still no canonical identity
 * table anywhere in this repository; this table does not become one.
 */
export const credentials = authIdentityPgSchema.table(
  "credential",
  {
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    identifier: text("identifier").notNull(),
    secretHash: text("secret_hash").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.kind] }),
    unique("credential_kind_identifier_key").on(table.kind, table.identifier),
  ],
);
