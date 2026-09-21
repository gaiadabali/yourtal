import { defineConfig, devices } from "@playwright/test";

/**
 * A deliberately SEPARATE Playwright config from `playwright.config.ts`,
 * for exactly one spec: `e2e/offline-voucher-detail.spec.ts` (YT-0424,
 * "renders from cache with the network disabled").
 *
 * UPDATE (YT-0588): the `--webpack` workaround below is GONE. `pnpm build`
 * now compiles the service worker itself, as a step after `next build`
 * (`scripts/build-service-worker.mjs`), so this suite runs against exactly
 * what ships instead of against a bundler nothing else uses. The original
 * reasoning is kept because it explains why the separate config still
 * exists at all — it needs its own port and a serial run, not its own
 * bundler.
 *
 * WHY THIS CANNOT SHARE THE MAIN CONFIG'S `webServer`: that server runs
 * `next build && next start`, and this app's `next build` defaults to
 * Turbopack (Next 16's own default; nothing in this repo forces webpack).
 * Serwist's stable Next.js integration (`@serwist/next`, wired in
 * `next.config.ts`) hooks into webpack's compiler — under Turbopack it is
 * silently a no-op: no build error, no warning at build time, and
 * `public/sw.js` is simply never written. Proving the offline behaviour
 * therefore needs a real `next build --webpack` — a build flavour this
 * repo does not otherwise run anywhere. Forcing `--webpack` onto the main
 * `playwright.config.ts` server would also silently break YT-0404's perf
 * budget gate: `.next/diagnostics/route-bundle-stats.json`
 * (`scripts/perf-check-bundle-size.mjs` reads it directly) is only written
 * by a Turbopack build — verified directly against a webpack build in this
 * ticket's own testing, where the file does not exist afterwards. Changing
 * the app's default bundler for production is exactly the kind of
 * app-wide decision this ticket has no brief to make (see this ticket's
 * report), so this config isolates the one build flavour that needs
 * webpack instead of changing what `pnpm build`/`pnpm exec playwright
 * test` already run everywhere else.
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
    baseURL: "http://127.0.0.1:3102",
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],

  webServer: {
    command: "pnpm build && next start --port 3102",
    url: "http://127.0.0.1:3102",
    reuseExistingServer: !process.env["CI"],
    timeout: 300_000,
  },
});
