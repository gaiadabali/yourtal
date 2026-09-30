import { defineConfig, devices } from "@playwright/test";

const webPort = Number(process.env["WEB_PORT"] ?? 26450);
const apiPort = Number(process.env["PORT"] ?? 26451);

/**
 * 6.2.a/6.2.c's Check: the (auth) screens' own spec needs a LIVE `apps/api`
 * — same reasoning `playwright.a-identity.config.ts`'s header gives for
 * why a spec with this need gets its own config rather than joining the
 * fixture-only main one.
 *
 * `reuseExistingServer: true` unconditionally: meant to run against
 * `apps/api`/`apps/web` already started in the background on this slot's
 * own ports, the same way a developer runs `pnpm dev` day to day. It still
 * launches them itself if they are not up.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "b-register-login.spec.ts",
  fullyParallel: false,
  // One worker: the serial describe block shares one AU account across its
  // reset/login/verify tests, and `auth.register` is capped at 5/IP/hour.
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
      // 12.4.d/#5: the neutral age gate's guardian step only exists when
      // teen registration is open — this only takes effect on a cold
      // start; a reused already-running api keeps whatever it booted with.
      env: { ...process.env, TEEN_ACCOUNTS: "true" },
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
