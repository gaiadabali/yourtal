import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadJobs } from "./job-loader";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "job-loader.fixtures");

describe("loadJobs", () => {
  it("loads every file exporting `job`, ignoring files that don't, with no list anywhere naming them", async () => {
    const loaded = await loadJobs(path.join(fixturesDir, "ok"));

    // 1.3.e's Check: `second.job.ts` was added after `real.job.ts` with no
    // edit to this file or to job-loader.ts — both show up because loadJobs
    // scans the directory, not a registry.
    expect(loaded.map((entry) => entry.file).sort()).toEqual(["real.job.ts", "second.job.ts"]);
    // helper.ts (no `job` export) is silently absent, not an error.
    expect(loaded.some((entry) => entry.file === "helper.ts")).toBe(false);

    const queues = loaded.map((entry) => entry.job.queue).sort();
    expect(queues).toEqual(["test.fixture.real", "test.fixture.second"].sort());
  });

  it("loads the built .js jobs the artifact ships, skipping .test.js and .d.ts", async () => {
    const loaded = await loadJobs(path.join(fixturesDir, "built"));
    expect(loaded.map((entry) => entry.file)).toEqual(["built.job.js"]);
  });

  it("throws when a file exports something named `job` with the wrong shape", async () => {
    await expect(loadJobs(path.join(fixturesDir, "bad"))).rejects.toThrow(/not a valid WorkerJob/);
  });
});
