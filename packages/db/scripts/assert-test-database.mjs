// YT-0571 — one guard, loaded as a Vitest `setupFiles` entry by every
// Postgres-backed package (apps/api, packages/db, packages/idempotency,
// packages/queue), so a suite run without `with-test-db.mjs` fails loudly
// instead of quietly writing into dev data.
//
// A setupFile, not `globalSetup`: `globalSetup` runs in a SEPARATE process,
// before Vitest applies a config's `test.env` to the worker — see
// with-test-db.mjs's own header for the exact ordering bug that bit
// apps/api once already (a fallback computed before the value that should
// have won it was set). This file runs INSIDE the worker, after `test.env`,
// so it sees the value the tests themselves are about to use.
//
// No exported function — importing this module for its side effect IS the
// check, which is what `setupFiles` wants (a path, not a factory to call).

const TEST_DB_PREFIX = "yourtal_test_";

for (const envVar of ["DATABASE_URL", "DATABASE_OWNER_URL"]) {
  const raw = process.env[envVar];
  if (raw === undefined || raw === "") {
    throw new Error(
      `${envVar} is not set. This suite refuses to guess a database — run this package's ` +
        `own \`pnpm test\`, which goes through packages/db/scripts/with-test-db.mjs and ` +
        `creates a fresh ${TEST_DB_PREFIX}* database, rather than invoking vitest directly.`,
    );
  }
  const name = databaseNameOf(raw, envVar);
  if (!name.startsWith(TEST_DB_PREFIX)) {
    throw new Error(
      `${envVar} names database "${name}", which is not a ${TEST_DB_PREFIX}* database — ` +
        `refusing to run against it. Run this package's own \`pnpm test\` instead, which ` +
        `points ${envVar} at a fresh ${TEST_DB_PREFIX}* database.`,
    );
  }
}

function databaseNameOf(rawUrl, envVar) {
  try {
    return new URL(rawUrl).pathname.replace(/^\//, "");
  } catch (error) {
    throw new Error(
      `${envVar}=${JSON.stringify(rawUrl)} could not be parsed as a database URL: ${String(error)}`,
    );
  }
}
