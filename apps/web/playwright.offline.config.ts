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
 */
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

  webServer: {
    command: `pnpm build && next start --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env["CI"],
    timeout: 300_000,
  },
});
