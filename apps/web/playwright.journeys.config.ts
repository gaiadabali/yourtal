import { defineConfig, devices } from "@playwright/test";

/**
 * 13.3.a: the viewer journeys (`e2e/journeys/`) against a running demo world,
 * local or staging. It starts no server: point `JOURNEY_BASE_URL` at one.
 */
export default defineConfig({
  testDir: "./e2e/journeys",
  fullyParallel: false,
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 20_000 },
  retries: 0,
  reporter: process.env["CI"] ? "github" : "list",
  use: {
    baseURL: process.env["JOURNEY_BASE_URL"] ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } }],
});
