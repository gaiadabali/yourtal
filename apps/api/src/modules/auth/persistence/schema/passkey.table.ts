import {
  bigint,
  boolean,
  customType,
  foreignKey,
  index,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { authIdentityPgSchema } from "./auth-identity-schema";
import { credentials } from "./credential.table";

/** Drizzle has no `bytea` mapping; node-postgres already returns a `Buffer`. */
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/**
 * `identity.passkey`: one row per WebAuthn credential. Hangs off the account's
 * single `kind = 'passkey'` row in `identity.credential` with ON DELETE
 * CASCADE, so erasing credentials erases passkeys (see the migration).
 */
export const passkeys = authIdentityPgSchema.table(
  "passkey",
  {
    credentialId: text("credential_id").primaryKey(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull().default("passkey"),
    publicKey: bytea("public_key").notNull(),
    signCount: bigint("sign_count", { mode: "number" }).notNull().default(0),
    transports: text("transports").array().notNull().default([]),
    deviceType: text("device_type").notNull(),
    backedUp: boolean("backed_up").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => [
    index("passkey_user_id").on(table.userId),
    foreignKey({
      columns: [table.userId, table.kind],
      foreignColumns: [credentials.userId, credentials.kind],
    }).onDelete("cascade"),
  ],
);
