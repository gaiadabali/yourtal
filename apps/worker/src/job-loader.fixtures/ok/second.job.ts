import { defineJob } from "../../job";

/**
 * A SECOND fixture job, added after `real.job.ts` with no edit to any other
 * file — this is what `job-loader.test.ts` and 1.3.e's Check are proving:
 * `loadJobs` finds both with no list anywhere naming them.
 */
export let executionCount = 0;

export const job = defineJob({
  queue: "test.fixture.second",
  // Proves the runner schedules a job that asks for it (worker.test.ts).
  schedule: "0 3 * * *",
  async handle() {
    executionCount += 1;
    return Promise.resolve();
  },
});
