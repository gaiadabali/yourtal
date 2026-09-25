import { defineConfig, devices } from "@playwright/test";
import { playwrightPort } from "./playwright-port";

// Offsets stay inside the slot's own range (base+0..+9): the main suite is
// +0, offline +2, run-server control +3, rendered +4, and this app server +5.
// +6 and up belong to the next slot (slot 2's +6 is slot 3's web port).
// scripts/visual.mjs computes the control port on its own; keep them in step.
const port = playwrightPort(5);
const controlPort = playwrightPort(3);

/**
 * Baseline screenshots for every primitive in the gallery (TASKS.md 3.6.b),
 * driven by `pnpm test:visual` (scripts/visual.mjs), never invoked directly.
 *
 * Unlike every other config in this file's directory, the BROWSER is not
 * launched locally: `use.connectOptions.wsEndpoint` points at a Playwright
 * `run-server` that scripts/visual.mjs starts inside
 * `mcr.microsoft.com/playwright:v1.63.0-noble`. Only that Linux container
 * renders pixels; the Next.js server this config's `webServer` starts still
 * runs on the HOST, because this workspace's node_modules hold native
 * binaries (`@tailwindcss/oxide`, `esbuild`, `lightningcss`, `@next/swc`)
 * built for this machine and unable to run inside the Linux container.
 *
 * That split is what makes a baseline made on this Windows machine match
 * what CI (ubuntu-latest) produces: the same Linux Chromium build and the
 * same Linux font stack render every pixel, regardless of which OS ran
 * `next build`/`next start`.
 *
 * The host server has to be reachable FROM the container, so `baseURL` uses
 * `host.docker.internal` rather than `127.0.0.1`, and the server itself
 * binds `0.0.0.0` (`webServer.command` below), unlike every other config
 * here, which binds `127.0.0.1`. On Linux (CI), `host.docker.internal` —
 * resolved via the container's `--add-host=host.docker.internal:host-gateway`
 * — is the host's real address, not its loopback interface, so a server
 * bound only to `127.0.0.1` would refuse the connection; `0.0.0.0` is the
 * minimum that works on both platforms. This opens the port to the whole
 * LAN for the few minutes the test run takes, which is acceptable for an
 * ephemeral slot port during a local/CI test run, not something to reuse
 * for a long-lived process.
 *
 * `snapshotPathTemplate` deliberately drops the `{platform}`/`{projectName}`
 * segments Playwright's default template adds — those are exactly what
 * would make a Windows-made baseline mismatch a Linux CI run by path alone,
 * on top of by pixels. The `{arg}` each spec passes to `toHaveScreenshot`
 * already encodes section id, width and theme, so it is the only variable
 * segment needed.
 */
export default defineConfig({
  testDir: "./visual",
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  // Fail a stuck run within minutes instead of eating the whole CI job.
  globalTimeout: 10 * 60_000,
  retries: process.env["CI"] ? 2 : 0,
  reporter: process.env["CI"] ? "github" : "list",

  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      // Small on purpose: these are primitive baselines, not full pages —
      // a real regression should fail, sub-pixel AA noise should not.
      maxDiffPixelRatio: 0.01,
    },
  },

  use: {
    baseURL: `http://host.docker.internal:${port}`,
    connectOptions: { wsEndpoint: `ws://127.0.0.1:${controlPort}/` },
    reducedMotion: "reduce",
    trace: "on-first-retry",
  },

  // No `channel: "chrome"` here (unlike playwright.config.ts): connectOptions
  // ignores launch options, including channel — the container only ever
  // offers Playwright's own bundled Chromium.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  // CI builds once and starts the server itself (UI_SERVER_EXTERNAL=1): on
  // Linux a server started here outlived Playwright's teardown and hung the job.
  webServer: process.env["UI_SERVER_EXTERNAL"]
    ? []
    : {
        command: `pnpm build && pnpm start --port ${port} -H 0.0.0.0`,
        url: `http://127.0.0.1:${port}/lab/ui`,
        env: { YOURTAL_LAB: "1" },
        reuseExistingServer: !process.env["CI"],
        timeout: 300_000,
      },
});
