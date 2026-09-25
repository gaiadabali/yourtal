import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    passWithNoTests: false,
    // YT-0571: refuses to run this suite against anything but a
    // yourtal_test_* database — see packages/db/scripts/assert-test-database.mjs.
    setupFiles: ["../db/scripts/assert-test-database.mjs"],
    // postgres-store.test.ts talks to the real Postgres from `pnpm dev:up`.
    //
    // YT-0547: `fileParallelism: false` used to be set here against the
    // wrong threat — the risk was never a SIBLING FILE in this package (it
    // is the only one that touches Postgres; `fingerprint.test.ts` and
    // `idempotency.test.ts` are pure logic), it was a sibling PACKAGE, since
    // every Postgres-backed package pointed at the one real "yourtal"
    // database. `pnpm test` here now runs through
    // `../db/scripts/with-test-db.mjs`, which creates a database named for
    // this package (a random suffix per invocation — see that script for
    // why a fixed name is not enough once two sessions can both be testing
    // this same package at once) before `vitest` starts and drops it
    // after, so there is nothing left in this package for file parallelism
    // to endanger.
    testTimeout: 20_000,
    // `testTimeout` does not cover hooks, and this suite's `beforeAll`
    // opens the pool that every test then uses — the shared convention
    // `packages/db/vitest.config.ts` and `apps/api/vitest.config.ts` also
    // follow.
    hookTimeout: 30_000,
  },
});
