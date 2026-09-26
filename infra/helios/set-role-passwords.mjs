// Sets the database role passwords from app.env on every deploy (2.1.d).
// The migrations create these roles with local-only passwords that are public
// in the repo; each role's real password is the one in its own connection URL,
// so app.env stays the single source of truth.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const release = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { Client } = createRequire(path.join(release, "api/package.json"))("pg");

const fromUrl = (name) => {
  const raw = process.env[name];
  if (!raw) throw new Error(`${name} is not set in app.env`);
  const url = new URL(raw);
  return { user: decodeURIComponent(url.username), password: decodeURIComponent(url.password) };
};

const roles = [
  fromUrl("DATABASE_URL"),
  fromUrl("LEDGER_DATABASE_URL"),
  fromUrl("VOUCHER_DATABASE_URL"),
  fromUrl("ANALYST_DATABASE_URL"),
];

const client = new Client({ connectionString: process.env.DATABASE_OWNER_URL });
await client.connect();
try {
  for (const { user, password } of roles) {
    if (!/^yourtal_[a-z]+$/.test(user)) throw new Error(`unexpected role name: ${user}`);
    if (password.length < 24 || password.endsWith("_local_only")) {
      throw new Error(`${user}: refusing a short or repo-published password`);
    }
    // Identifiers cannot be bound; the name is checked above. The password is
    // passed as a literal through format() on the server side.
    const { rows } = await client.query(
      "SELECT format('ALTER ROLE %I PASSWORD %L', $1::text, $2::text) AS sql",
      [user, password],
    );
    await client.query(rows[0].sql);
    console.log(`[pre-reload] password set for ${user}`);
  }
} finally {
  await client.end();
}
