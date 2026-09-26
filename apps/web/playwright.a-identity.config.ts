import { defineConfig, devices } from "@playwright/test";

const webPort = Number(process.env["WEB_PORT"] ?? 26343);
const apiPort = Number(process.env["PORT"] ?? 26344);

/**
 * 1.7.e's Check: the one Playwright spec so far that needs a LIVE
 * `apps/api`, not fixtures — every other suite in this file's siblings is
 * deliberately backend-free (`playwright.offline.config.ts`'s own header
 * explains why a spec with different needs gets its own config rather than
 * joining the main one; same reasoning here). Runs on THIS WORKTREE'S OWN
 * real dev ports (`WEB_PORT`/`PORT` from the root `.env`), not a
 * Playwright-dedicated offset port like the other configs use — the point
 * is proving the real stack (register through the real API, sign in
 * through the real `loginAction`, render through a real `GET /api/me`),
 * not a built bundle.
 *
 * `reuseExistingServer: true` unconditionally: this is meant to be run
 * against servers already started in the background (`pnpm --filter
 * @yourtal/api dev` / `@yourtal/web dev`), the same way a developer runs
 * `pnpm dev` day to day. It still launches them itself if they are not up.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "a-identity-plumbing.spec.ts",
  fullyParallel: false,
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
