#!/usr/bin/env node
// YT-0547 — one Postgres database per package for tests, not one file lock.
//
//   node scripts/test-db.mjs create <name>   drop-if-exists, create, schema, migrate
//   node scripts/test-db.mjs drop <name>     drop (force), leave the cluster alone
//
// This is the piece that makes "one database per package" real rather than
// aspirational. It is invoked by `with-test-db.mjs` (this directory), never
// by hand in normal use.
//
// ## Why a whole database, not a schema or a savepoint
//
// `turbo run test` (and, before this ticket, `pnpm verify` without
// `--concurrency=1`) ran @yourtal/db and @yourtal/api against the SAME
// physical database, "yourtal". `fileParallelism: false` in each package's
// `vitest.config.ts` only ever serialised files INSIDE that one package —
// it did nothing about a sibling package's process, running at the same
// time, against the same rows. A database boundary is the only thing here
// that is enforced by Postgres itself rather than by an agreement between
// two Node processes that have never heard of each other.
//
// ## Why this does not touch a migration
//
// This script never edits `migrations/*.sql` or `atlas.sum`. It creates an
// empty database, applies the schema-and-role bootstrap that
// `docker-entrypoint-initdb.d` normally applies once per cluster
// (`infra/postgres/init/01-schemas.sql`, read and executed verbatim — not
// re-derived, so it cannot drift from the one the real stack uses), and then
// shells out to the EXISTING `atlas.mjs apply` against the new database's
// owner URL. Every table, constraint and grant it ends up with came from the
// same migrations `pnpm db:migrate` runs against the real "yourtal" — this
// script only ever chooses WHERE they run.
//
// ## Why the name is a parameter, never a literal here
//
// YT-0558's worst instance was a test helper with a hard-coded per-laptop
// database name (`yourtal_wt_store`) as a silent fallback: it passed
// locally for the one reason that mattered, that the database happened to
// exist on that machine, and said nothing when it did not. This script
// never invents a name — its caller (`with-test-db.mjs`) derives one from
// the package's own `package.json`, and this script's only job with that
// name is to validate it (reject anything that is not a safe identifier,
// since it is interpolated into DDL that cannot be parameterised) and then
// make it real: created if `create` is asked, gone if `drop` is asked.
// There is no fallback name anywhere in this file.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";
import pg from "pg";

const { Client } = pg;

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");

try {
  process.loadEnvFile(path.join(repoRoot, ".env"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const [command, rawName] = process.argv.slice(2);

if (command !== "create" && command !== "drop") {
  console.error(`Unknown command "${String(command)}". Use: create <name> | drop <name>`);
  process.exit(1);
}

// Interpolated into DDL below (CREATE/DROP DATABASE cannot take a bound
// parameter for an identifier), so this is validated rather than escaped.
// Deliberately strict: lower-case, starts with a letter, no punctuation
// Postgres would need quoting for. A name that fails this is almost
// certainly not one a package's own setup derived — it is exactly the shape
// of mistake this ticket exists to make impossible to make quietly.
if (typeof rawName !== "string" || !/^[a-z][a-z0-9_]{2,62}$/.test(rawName)) {
  console.error(
    `Refusing to touch a database named ${JSON.stringify(rawName ?? "")}. ` +
      'Expected a lower-case identifier like "yourtal_test_api", derived by the caller ' +
      "from its own package.json — this script does not invent names.",
  );
  process.exit(1);
}
const name = rawName;

const ownerUrl = process.env.DATABASE_OWNER_URL;
if (ownerUrl === undefined) {
  console.error(
    "No DATABASE_OWNER_URL. Creating or dropping a test database needs the owner " +
      "credential, same as a migration does — copy .env.example to .env and run " +
      "`pnpm dev:up` from the repo root.",
  );
  process.exit(1);
}

// Postgres cannot CREATE/DROP DATABASE while connected to the database in
// question, or (for DROP) usefully to anything the caller cares about
// keeping open — so every admin operation here connects to the cluster's
// always-present "postgres" maintenance database instead.
const adminUrl = ownerUrl.replace(/\/[^/?]+(\?|$)/, "/postgres$1");
const targetOwnerUrl = ownerUrl.replace(/\/[^/?]+(\?|$)/, `/${name}$1`);

if (command === "drop") {
  await dropDatabase();
  process.exit(0);
}

// create: a genuinely fresh database every time, not a reused one. A
// previous run's leftover rows are exactly the "collides on a primary key
// for a reason unrelated to what it tests" failure this ticket's second
// fold-in rule names — dropping first removes that failure mode at the
// database level instead of relying on every test file to get table-level
// cleanup right.
await dropDatabase();
await createDatabase();
await applySchemaBootstrap();
runMigrations();
runSeed();
process.exit(0);

async function dropDatabase() {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    // WITH (FORCE) — Postgres 13+, and this stack runs postgres:18-alpine —
    // terminates any lingering connections from a previous run that did not
    // reach its own teardown (a killed test process, a crashed hook). A
    // database that refuses to drop because something is still connected to
    // it is not a safe thing to leave half-torn-down for the NEXT run to
    // trip over.
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

async function createDatabase() {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}" OWNER yourtal`);
  } finally {
    await admin.end();
  }
}

async function applySchemaBootstrap() {
  // The SAME file `docker-entrypoint-initdb.d` runs once against the real
  // "yourtal" database at container creation — read and executed verbatim,
  // not re-typed here, so the six domain schemas and their GRANT/REVOKE
  // boundaries cannot drift from what the real stack enforces. Only the
  // schema-and-grant statements are safe to replay against an arbitrary
  // database; `02-zitadel.sql` creates an unrelated, cluster-wide database
  // and is intentionally not applied here.
  const sqlPath = path.join(repoRoot, "infra", "postgres", "init", "01-schemas.sql");
  const sql = readFileSync(sqlPath, "utf8");
  const target = new Client({ connectionString: targetOwnerUrl });
  await target.connect();
  try {
    await target.query(sql);
  } finally {
    await target.end();
  }
}

function runSeed() {
  // `voucher-constraints.test.ts` and `voucher-issuance-constraints.test.ts`
  // (packages/db) say so themselves in their own failure message: "run
  // `pnpm db:seed` first — these need a real voucher/listing". Against the
  // real "yourtal" database that has always been true by hand, once, ages
  // ago. Against a database this script creates from nothing every run, it
  // has to be true every time — so the same seed `pnpm dev:fresh` runs is
  // run here too, as the owner, before anything else touches the database.
  // `seed()` is deliberately idempotent (ON CONFLICT DO NOTHING) and cheap
  // (packages/db/src/seed.test.ts measures it at about a second), so paying
  // for it on every package's `create` is not the expensive part of this
  // script — `docker run`ning Atlas is.
  const result = spawnSync(
    process.execPath,
    ["--import", "@swc-node/register/esm-register", path.join(packageRoot, "src", "seed.ts")],
    {
      cwd: packageRoot,
      stdio: "inherit",
      env: { ...process.env, DATABASE_OWNER_URL: targetOwnerUrl },
    },
  );
  if (result.error) {
    console.error(`\nCould not seed "${name}": ${result.error.message}`);
    process.exit(1);
  }
  if ((result.status ?? 1) !== 0) {
    console.error(`\nSeeding failed against "${name}" (exit ${String(result.status)}).`);
    process.exit(result.status ?? 1);
  }
}

function runMigrations() {
  // The existing migration runner, unmodified, pointed at the new
  // database's owner URL instead of the real one. Every table, index and
  // grant this database ends up with is defined exactly once, in
  // `migrations/*.sql`, and this is the only line in this file that reads
  // them.
  const result = spawnSync(
    process.execPath,
    [path.join(packageRoot, "scripts", "atlas.mjs"), "apply"],
    {
      cwd: packageRoot,
      stdio: "inherit",
      env: { ...process.env, DATABASE_OWNER_URL: targetOwnerUrl },
    },
  );
  if (result.error) {
    console.error(`\nCould not run migrations against "${name}": ${result.error.message}`);
    process.exit(1);
  }
  if ((result.status ?? 1) !== 0) {
    console.error(`\nMigrations failed against "${name}" (exit ${String(result.status)}).`);
    process.exit(result.status ?? 1);
  }
}
