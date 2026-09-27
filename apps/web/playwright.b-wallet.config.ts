import { defineConfig, devices } from "@playwright/test";

const webPort = Number(process.env["WEB_PORT"] ?? 26336);
const apiPort = Number(process.env["PORT"] ?? 26337);

/**
 * 6.5.c's Check, against a LIVE `apps/api` PLUS a live ledger and voucher
 * (`WALLET_VOUCHER_LIVE=1` — see `b-wallet-voucher.spec.ts`'s own header for
 * why this needs its own config, same reasoning as
 * `playwright.a-identity.config.ts`): the wallet's QR rotates using real
 * signed tokens from `services/voucher`'s keyring, and a dispute reinstates
 * real ledger points exactly once.
 *
 * `reuseExistingServer: true`: run `apps/api` yourself first with
 * `LEDGER_MODE=live` pointed at a real ledger/voucher (see that spec's
 * header for the exact commands), the same "already running in the
 * background" pattern `playwright.a-identity.config.ts` uses.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "b-wallet-voucher.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env["CI"],
  retries: 0,
  reporter: process.env["CI"] ? "github" : "list",
  timeout: 120_000,

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
