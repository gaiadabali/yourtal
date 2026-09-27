import { defineConfig, devices } from "@playwright/test";

const webPort = Number(process.env["WEB_PORT"] ?? 26440);
const apiPort = Number(process.env["PORT"] ?? 26441);

/**
 * 7.8.d's Check: Studio needs a LIVE `apps/api` (and `YOURTAL_DATA_SOURCE=live`
 * in this worktree's own `.env`, sourced before `pnpm dev` starts both
 * servers) — same reasoning `playwright.a-identity.config.ts`'s header
 * gives for why a spec with this need gets its own config.
 *
 * `reuseExistingServer: true` unconditionally: meant to run against
 * `apps/api`/`apps/web` already started in the background on this slot's
 * own ports, the same way a developer runs `pnpm dev` day to day. It still
 * launches them itself if they are not up (in which case they inherit
 * whatever `YOURTAL_DATA_SOURCE` is in the calling shell's environment —
 * source `.env` first).
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "c-studio-*.spec.ts",
  fullyParallel: false,
  // One worker: register is capped at 5/IP/hour (`REGISTER_RATE_LIMIT`) and
  // the serial describe block below shares one account/business across its
  // tests.
  workers: 1,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? "github" : "list",
  timeout: 60_000,

  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: "on-first-retry",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],

  webServer: [
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
