#!/usr/bin/env node
// YT-0547 — "each package that touches Postgres gets its own database,
// created and dropped by its own setup."
//
//   node <repo>/packages/db/scripts/with-test-db.mjs -- vitest run
//
// Run from a package's own directory (its `test` script invokes this with
// the package's own cwd), this:
//
//   1. derives that package's test database name from ITS OWN package.json
//   2. creates it fresh (test-db.mjs: drop-if-exists, create, schema, migrate)
//   3. points DATABASE_URL / DATABASE_OWNER_URL / TEST_DATABASE_URL /
//      TEST_DATABASE_NAME / LEDGER_DATABASE_URL / VOUCHER_DATABASE_URL at it
//      for the child process only
//   4. runs the given command (normally `vitest run`, or `go test` for the
//      ledger/voucher services — YT-0571) as that child
//   5. drops the database again, whether the command passed or not
//
// ## Why the name comes from `package.json`, not a literal in this file
//
// YT-0558's worst instance was a test helper with the fallback name
// `yourtal_wt_store` typed into source — a name that existed on exactly one
// laptop, so the test that depended on it "passed" for a reason that had
// nothing to do with the code under test. This file has no name literal for
// any package. It reads the caller's OWN `package.json` — the one piece of
// identity every package already has to have, that already goes through
// review when it changes — and turns `@yourtal/api` into `yourtal_test_api`
// mechanically. Nobody has to remember to update a table of names when a
// package is added; there is no table.
//
// ## Why the database step happens BEFORE `vitest` even starts
//
// `vitest.config.ts` in `apps/api` computes its `env.DATABASE_URL` fallback
// once, when the config module loads — before any `globalSetup` hook could
// run. A `globalSetup` that created the database and then mutated
// `process.env` would be creating it too late to affect that computed
// value, and the app-boot tests that read `process.env.DATABASE_URL`
// directly would keep talking to the wrong database while the rest of the
// suite, reading `TEST_DATABASE_URL`, correctly used the new one — a
// split-brain WORSE than not fixing this at all, because it would look
// like isolation while only half-applying it. Setting the environment in
// the PARENT process, before `vitest` is even spawned, is the only ordering
// that is not fighting Vitest's own lifecycle.
//
// ## Why this is one shared script, not three near-identical ones
//
// The two rules this ticket asks to fold into a convention — cleanup at the
// START of a run, and `hookTimeout` rather than `testTimeout` — both exist
// because each package's test setup carried its own memory of them. This
// file is that convention for the third recurring piece: how the database
// itself gets stood up and torn down. One definition, so a fourth package
// with a Postgres suite copies an invocation, not a design.
//
// ## Why the name is per-INVOCATION, not a fixed per-package name
//
// The first version of this script derived a single fixed name per package
// (`yourtal_test_api`, always). Live in this exact repo, with other agents'
// sessions genuinely running concurrently against the same Postgres
// cluster, that name collided with ITSELF: two invocations of `apps/api`'s
// `pnpm test`, in two sessions, both trying to be the one that drops and
// (re)creates `yourtal_test_api` — `pg_stat_activity` caught it directly,
// one session's Atlas holding an advisory lock on the database the other
// had just dropped out from under it. That is this ticket's own reported
// symptom (three sessions, one file failing and then a different one, each
// passing alone) reproduced one layer down: a package boundary is not a
// SESSION boundary when every session shares one Postgres. So the name
// carries a random suffix generated fresh by THIS invocation — still
// derived, never hand-typed, and now also never shared with a concurrent
// run of the very same package.
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const testDbScript = path.join(scriptsDir, "test-db.mjs");

// The CALLING package's own directory — this script is invoked with that
// package as `cwd` by its `test` script (`node <path>/with-test-db.mjs --
// vitest run`), never with `packages/db` itself as the working directory
// even when @yourtal/db is the caller.
const callerRoot = process.cwd();

const pkgJsonPath = path.join(callerRoot, "package.json");
let pkgName;
try {
  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  pkgName = pkg.name;
} catch (error) {
  console.error(
    `with-test-db.mjs could not read ${pkgJsonPath}: ${error instanceof Error ? error.message : String(error)}\n` +
      "This script derives the test database name from the caller's own package.json " +
      "and refuses to guess one instead.",
  );
  process.exit(1);
}
if (typeof pkgName !== "string" || pkgName.length === 0) {
  console.error(`${pkgJsonPath} has no usable "name" field — cannot derive a database name.`);
  process.exit(1);
}

// "@yourtal/api" -> "api", "@yourtal/idempotency" -> "idempotency". Anything
// that is not `[a-z0-9]` after that collapses to "_" — the identifier rule
// `test-db.mjs` itself enforces, applied here too so a bad package name
// fails in THIS process with a clear reason, not inside a DDL error two
// scripts away.
const short = pkgName
  .replace(/^@yourtal\//, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "_");
// 8 hex characters of a fresh UUID — enough that two concurrent invocations
// picking the same one is not a realistic event, unlike two concurrent
// invocations picking the same PACKAGE (which happens routinely: any two
// sessions both testing `apps/api`).
const runToken = randomUUID().replace(/-/g, "").slice(0, 8);
const dbName = `yourtal_test_${short}_${runToken}`;

const args = process.argv.slice(2);
const dashIndex = args.indexOf("--");
const command = dashIndex === -1 ? args : args.slice(dashIndex + 1);
if (command.length === 0) {
  console.error("Usage: with-test-db.mjs -- <command> [args...]  (e.g. -- vitest run)");
  process.exit(1);
}

const host = process.env.PGHOST_OVERRIDE ?? "127.0.0.1:26432";
const childEnv = {
  ...process.env,
  // Read directly by `env.schema.ts`/AppModule boot tests (apps/api) that
  // never go through TEST_DATABASE_URL at all.
  DATABASE_URL: `postgres://yourtal_app:app_local_only@${host}/${dbName}`,
  // Migrations, and this script's own owner-role cleanup step.
  DATABASE_OWNER_URL: `postgres://yourtal:yourtal_local_only@${host}/${dbName}`,
  // The override every Postgres-backed test file in apps/api and
  // packages/idempotency already reads (`process.env["TEST_DATABASE_URL"]
  // ?? <literal>`) for the deliberate-sabotage reason their own comments
  // give. Setting it here means none of those files needed to change.
  TEST_DATABASE_URL: `postgres://yourtal_app:app_local_only@${host}/${dbName}`,
  // `packages/db/src/database-urls.ts` builds APP_URL/OWNER_URL/LEDGER_URL/
  // VOUCHER_URL from this instead of the literal "yourtal".
  TEST_DATABASE_NAME: dbName,
  // Each run counts rate limits in its own keyspace of the shared Valkey.
  RATE_LIMIT_NAMESPACE: dbName,
  // YT-0571: the Go services' own test-only guard (internal/testdb, each
  // service) reads these directly — they have no TEST_DATABASE_NAME
  // fallback path to derive them from, unlike the TS side. Same roles as
  // packages/db/src/database-urls.ts's LEDGER_URL/VOUCHER_URL, same
  // cluster-wide passwords, pointed at THIS invocation's database.
  LEDGER_DATABASE_URL: `postgres://yourtal_ledger:ledger_local_only@${host}/${dbName}`,
  VOUCHER_DATABASE_URL: `postgres://yourtal_voucher:voucher_local_only@${host}/${dbName}`,
};

let exitCode = 1;
let created = false;
try {
  const createExit = await run(process.execPath, [testDbScript, "create", dbName], {
    env: process.env,
  });
  if (createExit !== 0) {
    console.error(
      `[with-test-db] could not create ${dbName} (exit ${String(createExit)}) — not running tests.`,
    );
    process.exit(createExit);
  }
  created = true;
  console.log(`[with-test-db] ${dbName} ready, running: ${command.join(" ")}`);
  // The downstream command (`vitest run`) is a bare name that only Windows'
  // shell resolves to the installed `.cmd` shim — everywhere else, and for
  // the two `node <script>` invocations above and below, no shell is used,
  // so nothing here needs the array-args-with-shell escaping Node warns
  // about.
  exitCode = await run(command[0], command.slice(1), {
    env: childEnv,
    cwd: callerRoot,
    useShell: process.platform === "win32",
  });
} finally {
  if (created) {
    console.log(`[with-test-db] dropping ${dbName}`);
    // Best-effort: a failed drop must not hide the test result above it,
    // and the NEXT run's `create` drops (with FORCE) before it creates
    // anyway.
    try {
      await run(process.execPath, [testDbScript, "drop", dbName], { env: process.env });
    } catch (error) {
      console.error(
        `[with-test-db] could not drop ${dbName} (next run's create will retry): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
process.exit(exitCode);

function run(cmd, cmdArgs, { useShell = false, ...options } = {}) {
  return new Promise((resolve, reject) => {
    // `shell: true` with an args ARRAY is what Node deprecated (unescaped
    // concatenation) — when a shell is actually needed (resolving a bare
    // command like `vitest` to its Windows `.cmd` shim), build one quoted
    // string ourselves instead of handing Node an array to mis-join.
    const child = useShell
      ? spawn(
          [cmd, ...cmdArgs].map((part) => (part.includes(" ") ? `"${part}"` : part)).join(" "),
          { stdio: "inherit", shell: true, ...options },
        )
      : spawn(cmd, cmdArgs, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${cmd} killed by ${signal}`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}
