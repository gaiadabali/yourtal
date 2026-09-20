import os from "node:os";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

/**
 * YT-0577: `pnpm verify` measurably fails under load — reproduced by
 * pegging every core with CPU burners alongside this suite. Two Vitest
 * default budgets are sized for an idle machine and get blown on a
 * contended one, and neither failure is specific to one test file:
 *
 * 1. `testTimeout` (default 5000ms) and `hookTimeout` (default 10000ms)
 *    time the whole test/hook in wall-clock time. Under scheduler
 *    contention (Go suites, Postgres, Cerbos, another agent all competing
 *    for the same cores), a worker process can sit runnable-but-unscheduled
 *    for seconds at a time, so even CPU-trivial tests — a `vi.resetModules()`
 *    + `await import(...)` reload with no `findBy`/`waitFor` at all
 *    (`provisioning-data.test.ts`, `region-cookie-roundtrip.test.ts`,
 *    `device-session-cookie.test.ts`) or a handful of sequential
 *    `userEvent` steps (`question-bank-screen.test.tsx`) — time out. None
 *    of these await a `next/dynamic` chunk; the timeout fires purely from
 *    starvation.
 * 2. Testing Library's `asyncUtilTimeout` (default 1000ms) governs every
 *    `findBy*`/`waitFor` poll. This is the one that hits `next/dynamic`
 *    components racing their chunk load (`video-player.test.tsx`'s resume
 *    prompt and quality selector), but it isn't limited to dynamic
 *    imports — `team-screen.test.tsx`'s plain (non-dynamic) Radix dialogs
 *    hit the identical default under load. Raised globally in
 *    `vitest.setup.ts` rather than per call site, because a per-site bump
 *    only ever covers the sites that happened to fail on the run that
 *    found them (see that file for the full audit and reasoning).
 *
 * Raising the ceilings alone chases a moving target — this repo already
 * tried that once: `merchant-redemption-screen.test.tsx` had hand-bumped
 * `{ timeout: 3000 }` / `it(..., 10000)` overrides and STILL failed under
 * load (those overrides have since been removed in favour of this global
 * policy, which is strictly more generous). So the other half of the fix
 * is reducing how many CPU-bound Vitest workers compete for the
 * same cores in the first place: fewer, well-fed workers finish in
 * roughly their real CPU cost; too many runnable-but-starved workers
 * produce exactly the ballooning tail latency measured here (39s idle →
 * 95s under moderate load → 160-180s and timeouts under heavy load).
 *
 * `maxWorkers` is derived from the machine's own reported core count
 * (never a hardcoded number — see docs/13c-lessons.md on machine-specific
 * constants), with an env override for tuning without touching this file.
 */
const cpuCount = os.availableParallelism?.() ?? os.cpus().length;
const maxWorkers = Number(process.env.VITEST_MAX_WORKERS) || Math.max(2, Math.floor(cpuCount / 2));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": rootDir,
    },
  },
  test: {
    environment: "jsdom",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next"],
    setupFiles: ["./vitest.setup.ts"],
    css: false,
    restoreMocks: true,
    // @testing-library/react registers its automatic post-test `cleanup()`
    // via the global `afterEach` hook, which only exists when globals are on.
    globals: true,
    // See the YT-0577 comment above: wall-clock budgets sized for an idle
    // machine, raised suite-wide rather than per file.
    testTimeout: 15_000,
    hookTimeout: 15_000,
    // Bound worker count so this suite doesn't try to claim every core
    // when Go suites / Postgres / Cerbos / another agent are already
    // competing for them. Vitest's own default is close to "one worker
    // per core," which is exactly the oversubscription this ticket
    // reproduced.
    maxWorkers,
  },
});
