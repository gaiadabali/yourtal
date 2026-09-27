import { defineConfig, devices } from "@playwright/test";
import { playwrightPort } from "./playwright-port";

// Two above the main suite's port, so both can run at once.
const port = playwrightPort(2);

/**
 * A deliberately SEPARATE Playwright config from `playwright.config.ts`,
 * for exactly one spec: `e2e/offline-voucher-detail.spec.ts` (YT-0424,
 * "renders from cache with the network disabled").
 *
 * WHY A SEPARATE CONFIG, as of YT-0588: a distinct port and a serial run.
 * That is the whole reason. It runs the SAME `pnpm build` as the main
 * config — no `--webpack`, no special bundler — so it measures exactly what
 * ships.
 *
 * ⚠️ THE ORIGINAL REASON IS GONE. DO NOT REINSTATE `--webpack`.
 *
 * This file used to argue at length that the offline proof required
 * `next build --webpack`, because `@serwist/next` hooks into webpack's
 * compiler and was a silent no-op under Turbopack, so `public/sw.js` was
 * never written. That was true when it was written and **YT-0588 removed
 * the constraint rather than working around it**:
 * `scripts/build-service-worker.mjs` compiles the worker with esbuild and
 * injects the precache manifest, independent of whichever bundler Next
 * uses. `pnpm build` produces the worker AND `next build` stays on
 * Turbopack.
 *
 * Why the warning is stronger than the tidy-up: forcing `--webpack` onto
 * any config **silently disables YT-0404's performance budget**.
 * `.next/diagnostics/route-bundle-stats.json`, which
 * `scripts/perf-check-bundle-size.mjs:53` reads directly, is written ONLY
 * by a Turbopack build. Per YT-0569 that gate is `pull_request`-only and
 * barely fires, so its disappearance would not be noticed. A reader acting
 * on the old paragraph would trade a live gate for a workaround that is no
 * longer needed.
 *
 * ⏭️ Whether this config still earns a separate file is a fair question
 * now that it runs the same build on another port. Kept for the serial run
 * and the dedicated port; folding it into the main config is a change worth
 * its own ticket rather than a side effect of correcting a comment.
 *
 * Run with: `pnpm exec playwright test --config=playwright.offline.config.ts`.
 * Port 3102 (distinct from the main config's 3100 and any dev server on
 * 3000) so this can run alongside the main e2e suite without colliding.
 *
 * 6.9 (F43): the rewritten spec needs a real, signed-in account and a real
 * voucher, so this config now also needs `apps/api` — reused if already
 * running (the same `reuseExistingServer: true` pattern
 * `playwright.a-identity.config.ts`/`playwright.b-wallet.config.ts` use),
 * with `LEDGER_MODE=live` and a real ledger + voucher built from source
 * (see `b-wallet-voucher.spec.ts`'s header for the exact commands — this
 * spec reuses that same live stack and seeding recipe via
 * `live-voucher-fixture.ts`). `WALLET_VOUCHER_LIVE=1` gates the spec itself.
 */
const apiPort = Number(process.env["PORT"] ?? 26344);

export default defineConfig({
  testDir: "./e2e",
  testMatch: "offline-voucher-detail.spec.ts",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  reporter: process.env["CI"] ? "github" : "list",
  // Service worker lifecycle events (install/activate/claim) are genuinely
  // slower than a normal page interaction — this file's own test already
  // waits on `navigator.serviceWorker.ready` rather than a fixed sleep, but
  // the default 30s test timeout is tight around two full navigations plus
  // that wait.
  timeout: 60_000,

  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],

  // F49: both commands below run the underlying binary directly rather than
  // through `pnpm --filter ... <script>` — CI (36324078873) hung for the
  // job's entire remaining 35-minute budget with zero further log output
  // once "Running 1 test using 1 worker" printed, and never reproduced
  // locally. `pnpm run <script>` forks a shell to run the script, which
  // forks the real process; killing the PID Playwright holds (pnpm's own)
  // does not reliably reach that grandchild on Linux, so a hung teardown
  // (Playwright waiting for the port to free) reads identically to a hung
  // test. Running `node .../src/main.ts` and `next build && ... && next
  // start` directly puts the real server process in the tail position of
  // its own shell, which bash/sh exec-replaces rather than forking again —
  // the PID Playwright manages IS the server, so its kill reaches it.
  webServer: [
    {
      command:
        "node --env-file-if-exists=../../.env --import @swc-node/register/esm-register src/main.ts",
      url: `http://127.0.0.1:${apiPort}/api/health`,
      // F49: unconditional `true` here (unlike the web entry below) left a
      // zombie api process running after every CI test run — reused-or-not,
      // Playwright never tears down a server this flag marks as "external".
      // Local dev still gets the convenience (reuse whatever's already up
      // on this port); CI never has one, so CI now always owns and kills it.
      reuseExistingServer: !process.env["CI"],
      timeout: 60_000,
      cwd: "../api",
    },
    {
      command: `next build && node scripts/build-service-worker.mjs && next start --port ${port}`,
      url: `http://127.0.0.1:${port}`,
      reuseExistingServer: !process.env["CI"],
      timeout: 300_000,
    },
  ],
});
