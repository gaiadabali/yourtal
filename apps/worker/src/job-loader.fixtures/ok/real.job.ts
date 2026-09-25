import { defineJob } from "../../job";

/**
 * Fixture for `job-loader.test.ts` and `worker.test.ts` — a real,
 * dynamically-loaded job file, not a mock. `executionCount` is a live ESM
 * binding: `worker.test.ts` imports it directly to observe `handle()`
 * actually running after a job is sent through a real `PgBoss` instance.
 */
export let executionCount = 0;

export const job = defineJob({
  queue: "test.fixture.real",
  async handle() {
    executionCount += 1;
    return Promise.resolve();
  },
});
