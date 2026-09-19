import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    passWithNoTests: false,
    // These talk to the real Postgres from docker-compose. Serial, because
    // they assert on database state and a parallel worker writing the same
    // ledger rows would make failures unreproducible.
    //
    // `fileParallelism: false` only serialises THIS package. `turbo run test`
    // still runs @yourtal/db and @yourtal/api at the same time, and
    // apps/api/src/app.boot.test.ts talks to the same database — so under
    // `pnpm verify` these are not actually alone with Postgres, whatever this
    // line says. Serialising the two packages against each other is a change
    // to the workspace gate, not to this file.
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
