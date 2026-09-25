import { defineConfig, devices } from "@playwright/test";
import { playwrightPort } from "./playwright-port";

const port = playwrightPort();

/**
 * Real-browser verification for the acceptance criteria jsdom cannot reach:
 * YT-0401's 320 px and 200 % zoom, YT-0402's layout stability, and
 * YT-0412's native seek-bar keyboard behaviour.
 *
 * `channel: "chrome"` drives the locally installed Chrome rather than a
 * Playwright-bundled Chromium. That is deliberate: the bundled download
 * times out against the CDN in this environment, and for layout, zoom and
 * CWV work a real Chrome is a closer match to what users run anyway.
 * CI should install the bundled browser instead — see the comment on
 * `projects` below.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  reporter: process.env["CI"] ? "github" : "list",

  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry",
  },

  projects: [
    {
      // Drop `channel` in CI and let Playwright use its own Chromium, which
      // is pinned to the library version and does not depend on whatever
      // Chrome happens to be installed on the machine.
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
    {
      // 320 px is the narrowest viewport YT-0401 must survive. Kept as its
      // own project so a failure names the viewport rather than hiding
      // inside a desktop run.
      name: "mobile-320",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        viewport: { width: 320, height: 640 },
        isMobile: false,
      },
    },
  ],

  webServer: {
    // A production build, not `next dev`: layout stability and bundle
    // behaviour differ, and these tests exist to check the shipped thing.
    command: `pnpm build && pnpm start --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env["CI"],
    timeout: 300_000,
  },
});
