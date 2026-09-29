import { defineConfig, devices } from "@playwright/test";

const webPort = Number(process.env["WEB_PORT"] ?? 26320);
const apiPort = Number(process.env["PORT"] ?? 26321);
// Set for a staging run (F76): no local servers, the real site instead.
const stagingUrl = process.env["STAFF_E2E_BASE_URL"];

/**
 * Phase 9's staff console specs, against a LIVE `apps/api` and `apps/web` on
 * this slot's own ports (same shape as `playwright.c-studio.config.ts`).
 * Source this worktree's `.env` first.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "c-staff-*.spec.ts",
  fullyParallel: false,
  // Register is capped at 5/IP/hour, so accounts are made sparingly and serially.
  workers: 1,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? "github" : "list",
  timeout: 90_000,
  use: { baseURL: stagingUrl ?? `http://127.0.0.1:${webPort}`, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
  webServer:
    stagingUrl !== undefined
      ? []
      : [
          {
            command: "pnpm --filter @yourtal/api dev",
            url: `http://127.0.0.1:${apiPort}/api/health`,
            reuseExistingServer: true,
            timeout: 60_000,
            cwd: "../..",
          },
          {
            command: "pnpm --filter @yourtal/web dev",
            url: `http://127.0.0.1:${webPort}`,
            reuseExistingServer: true,
            timeout: 60_000,
            cwd: "../..",
          },
        ],
});
