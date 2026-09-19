import { defineConfig } from "vitest/config";

/**
 * `apps/api`'s tests talk to the real Postgres and the real Cerbos from
 * `docker-compose`. YT-0527 wired the PDP; YT-0552 wired the database.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    passWithNoTests: false,

    /**
     * The app role, not the owner — so a missing grant fails here rather
     * than in production. Set in the config rather than left to each
     * developer's `.env`, because `app.boot.test.ts` boots the real
     * `AppModule`, which reads `process.env` directly, and a suite that only
     * passes on a machine that happens to have the variable is one that will
     * fail in CI for a reason nobody can reproduce locally.
     *
     * `DATABASE_URL` is required by `env.schema.ts` as of YT-0552. It used
     * to be optional, and the module fell back to in-memory repositories
     * when it was missing — so the whole backend ran, and its tests passed,
     * without a line of SQL ever executing.
     */
    env: {
      DATABASE_URL: "postgres://yourtal_app:app_local_only@127.0.0.1:26432/yourtal",
    },

    /**
     * Serial. Every file in this package now writes to one shared database,
     * and `clearBusinessTables` empties those tables — a parallel worker
     * would have its rows deleted mid-test by a neighbour, producing
     * failures that move around between runs.
     *
     * This is the same arrangement `packages/db` needs and for the same
     * reason. YT-0547 is the real fix: a database per package, at which
     * point removing this line is the proof the isolation is genuine.
     */
    fileParallelism: false,
    testTimeout: 20_000,
    /**
     * `testTimeout` does NOT cover hooks — Vitest times those separately at
     * a 10s default, and the expensive work here is in `beforeAll`, which
     * boots a Nest application and connects a pool.
     */
    hookTimeout: 30_000,
  },
});
