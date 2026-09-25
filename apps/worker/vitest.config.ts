import { defineConfig } from "vitest/config";

/**
 * `apps/worker`'s tests talk to the real Postgres from `pnpm dev:up`, via
 * `with-test-db.mjs` (YT-0547): a fresh, migrated database per invocation.
 * Same shape as `packages/queue`'s config, which this app is built on.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    passWithNoTests: false,
    // YT-0571: refuses to run this suite against anything but a
    // yourtal_test_* database — see packages/db/scripts/assert-test-database.mjs.
    setupFiles: ["../../packages/db/scripts/assert-test-database.mjs"],
    testTimeout: 20_000,
    // Hooks (starting pg-boss, defining queues) are the slow part, not the
    // assertions — same convention as packages/queue, packages/db and apps/api.
    hookTimeout: 30_000,
  },
});
