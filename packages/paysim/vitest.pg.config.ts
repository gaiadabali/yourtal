import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.pg.test.ts"],
    environment: "node",
    passWithNoTests: false,
    // Refuses to run against anything but a yourtal_test_* database.
    setupFiles: ["../db/scripts/assert-test-database.mjs"],
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
