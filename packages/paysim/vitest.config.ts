import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Postgres-backed suites run through `pnpm test:pg` (Integration workflow).
    exclude: [...configDefaults.exclude, "src/**/*.pg.test.ts"],
    environment: "node",
    passWithNoTests: false,
  },
});
