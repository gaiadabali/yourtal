import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    passWithNoTests: false,
    // YT-0571: refuses to run this suite against anything but a
    // yourtal_test_* database (assert-test-database.mjs's own header has
    // why it is a setupFile and not globalSetup).
    setupFiles: ["./scripts/assert-test-database.mjs"],
    // YT-0547. `fileParallelism: false` used to live here, with a comment
    // saying a parallel worker writing the same ledger rows would make
    // failures unreproducible. That was serialising files WITHIN this
    // package and nothing else: `turbo run test` still ran @yourtal/db and
    // @yourtal/api at the same time against the one real "yourtal"
    // database, so these suites were never actually alone with Postgres,
    // whatever the old comment claimed.
    //
    // `pnpm test` here now runs through `scripts/with-test-db.mjs`, which
    // creates a database named for this package (`yourtal_test_db_<token>`
    // — the suffix is random per invocation, see that script's header for
    // why a fixed name reintroduced the same cross-session collision one
    // level down) before `vitest` starts, and drops it after. Files within
    // it are safe to run in parallel because each
    // one clears and asserts on rows it scopes by a key it generated
    // itself (a session id, a campaign id, `funding_reference = 'probe'`),
    // not by wiping a whole shared table — see e.g. `voucher-constraints
    // .test.ts` and `watch-session.test.ts`.
    // Every file shares one test database, and several seed or count the same
    // tables (seed.test's idempotency counts, the staging seed's empty-world
    // gate). In parallel they raced and failed Integration; one file at a time
    // costs little here and removes the whole class.
    fileParallelism: false,
    testTimeout: 20_000,
    // `testTimeout` does NOT cover hooks — Vitest times those separately and
    // defaults to 10s. The expensive work here is in a hook: seed.test.ts's
    // `beforeAll` runs the whole seed, roughly 200 sequential round trips.
    // Run alone it takes about a second; run beside apps/api's Postgres
    // tests it blew the 10s default while every assertion in the file was
    // still well inside the 20s that had been deliberately set for them.
    //
    // So the suite passed alone and failed under `pnpm verify`, which is the
    // worst arrangement available: it reads as a flaky database rather than
    // as a timeout nobody had configured.
    hookTimeout: 30_000,
  },
});
