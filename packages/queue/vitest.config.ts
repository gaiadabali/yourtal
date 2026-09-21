import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    passWithNoTests: false,
    // Every suite here talks to the real Postgres from `pnpm dev:up`, via
    // `../db/scripts/with-test-db.mjs` (YT-0547): a fresh, migrated database
    // per invocation, so there is nothing left for file parallelism to
    // endanger the way a shared "yourtal" database would.
    testTimeout: 20_000,
    // Hooks (starting pg-boss, running its own supervisor pass) are the slow
    // part, not the assertions — same convention as packages/idempotency,
    // packages/db and apps/api.
    hookTimeout: 30_000,
  },
});
