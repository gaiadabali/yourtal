import { defineConfig, devices } from "@playwright/test";
import { playwrightPort } from "./playwright-port";

// Four above the main suite's port (the offline suite takes +2), so all three can run at once.
const port = playwrightPort(4);

/**
 * The rendered-output gate: checks what the built CSS actually does in a browser,
 * which unit tests on class strings cannot see. Builds with YOURTAL_LAB=1 so the
 * primitive gallery at /lab/ui exists.
 */
export default defineConfig({
  testDir: "./rendered",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  // Fail a stuck run within minutes instead of eating the whole CI job.
  globalTimeout: 10 * 60_000,
  retries: process.env["CI"] ? 2 : 0,
  reporter: process.env["CI"] ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry",
    ...devices["Desktop Chrome"],
    channel: "chrome",
  },
  // CI builds once and starts the server itself (UI_SERVER_EXTERNAL=1): on
  // Linux a server started here outlived Playwright's teardown and hung the job.
  webServer: process.env["UI_SERVER_EXTERNAL"]
    ? []
    : {
        command: `pnpm build && pnpm start --port ${port}`,
        url: `http://127.0.0.1:${port}/lab/ui`,
        env: { YOURTAL_LAB: "1" },
        reuseExistingServer: !process.env["CI"],
        timeout: 300_000,
      },
});
