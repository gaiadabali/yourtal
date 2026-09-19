import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
    restoreMocks: true,
    // @testing-library/react registers its automatic post-test `cleanup()`
    // via the global `afterEach` hook, which only exists when globals are on.
    globals: true,
  },
});
