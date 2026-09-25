#!/usr/bin/env node
// 1.5.b — pnpm staff:add <email> <role>
//
// Writes identity.staff_role directly against the OWNER connection. There
// is deliberately no HTTP route or application code path that can grant a
// staff role to itself (docs/14 section 8) — this script IS the only way
// one is ever created, run by a person with database access, never by the
// running application.
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

// Mirrors packages/authz/src/roles.ts's INTERNAL_ROLES — see that file for
// the source of truth. Kept as a literal copy rather than an import because
// this script runs standalone via `node`, outside the TS build; the
// migration's own CHECK constraint is the real backstop if the two ever
// drift, same reasoning as drizzle-staff-role-reader.ts's boundary parse.
const INTERNAL_ROLES = ["support", "moderator", "risk_analyst", "finance", "ops", "admin"];

function normalizeEmail(raw) {
  return raw.trim().toLowerCase();
}

async function main() {
  try {
    process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const [rawEmail, role] = process.argv.slice(2);
  if (rawEmail === undefined || role === undefined) {
    console.error("Usage: pnpm staff:add <email> <role>");
    console.error(`  <role> is one of: ${INTERNAL_ROLES.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  if (!INTERNAL_ROLES.includes(role)) {
    console.error(`"${role}" is not a staff role. Expected one of: ${INTERNAL_ROLES.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const ownerUrl = process.env.DATABASE_OWNER_URL;
  if (!ownerUrl) {
    console.error("DATABASE_OWNER_URL is not set.");
    process.exitCode = 1;
    return;
  }

  const email = normalizeEmail(rawEmail);
  const grantedBy = process.env.USER ?? process.env.USERNAME ?? "unknown";

  const client = new Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    // Password accounts' user_id IS the normalised email (apps/api/src/modules/auth/email.ts's
    // own comment) — looked up rather than assumed, so a typo'd email fails
    // clearly instead of silently staff-promoting a user id nobody owns.
    const credential = await client.query(
      "SELECT user_id FROM identity.credential WHERE kind = 'password' AND identifier = $1 LIMIT 1",
      [email],
    );
    const userId = credential.rows[0]?.user_id;
    if (userId === undefined) {
      console.error(`No account is registered with ${email}.`);
      process.exitCode = 1;
      return;
    }

    await client.query(
      `INSERT INTO identity.staff_role (user_id, role, granted_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, role) DO NOTHING`,
      [userId, role, grantedBy],
    );
    console.log(`Granted ${role} to ${email} (${userId}).`);
  } finally {
    await client.end();
  }
}

await main();
