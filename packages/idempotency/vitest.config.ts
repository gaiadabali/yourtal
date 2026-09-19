import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    passWithNoTests: false,
    // postgres-store.test.ts talks to the real Postgres from `pnpm dev:up`
    // and asserts on concurrent claims of the same key, so parallel files
    // writing the same rows would make failures unreproducible.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
