import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as realFixture from "./job-loader.fixtures/ok/real.job";
import { startWorker } from "./worker";
import type { RunningWorker } from "./worker";

/**
 * End to end against the real Postgres from `pnpm dev:up` (via
 * `with-test-db.mjs`, YT-0547): a real `PgBoss`, a real `defineQueue`, and
 * jobs discovered off disk by `loadJobs` rather than registered by hand in
 * this test. `real.job.ts`'s `executionCount` is a live ESM binding, so
 * importing it here observes the SAME module instance `startWorker` loaded
 * dynamically (Node's module cache is keyed by resolved file URL).
 */

// No hard-coded dev URL (YT-0571): `vitest.config.ts`'s `setupFiles` refuses
// to run this suite unless `DATABASE_URL` names a `yourtal_test_*` database.
const APP_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (APP_URL === undefined) throw new Error("DATABASE_URL/TEST_DATABASE_URL must be set");

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "job-loader.fixtures",
  "ok",
);

let worker: RunningWorker;

beforeAll(async () => {
  worker = await startWorker({ databaseUrl: APP_URL, jobsDir: fixturesDir, log: () => undefined });
});

afterAll(async () => {
  await worker.stop();
});

async function waitUntil(
  predicate: () => boolean,
  { timeoutMs = 15_000, intervalMs = 100 } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return;
    if (Date.now() > deadline) throw new Error("waitUntil: condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

describe("startWorker", () => {
  it("registers every job under jobsDir and runs it when a job is sent", async () => {
    expect(worker.jobs.map((entry) => entry.job.queue).sort()).toEqual(
      ["test.fixture.real", "test.fixture.second"].sort(),
    );

    const before = realFixture.executionCount;
    const jobId = await worker.boss.send("test.fixture.real", {});
    expect(jobId).not.toBeNull();

    await waitUntil(() => realFixture.executionCount > before);
    expect(realFixture.executionCount).toBe(before + 1);
  }, 20_000);
});
