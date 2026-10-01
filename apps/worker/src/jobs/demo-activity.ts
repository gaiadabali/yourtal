import { Pool } from "pg";
import { runDemoActivity } from "@yourtal/db/demo-world/activity";
import { defineJob } from "../job";

/**
 * 13.1.b: one more day of demo history each morning (UTC), through the real
 * api, so a week after a reset the world has a week behind it.
 */
export const job = defineJob({
  queue: "demo-activity",
  schedule: "0 2 * * *",
  // A reset renders video and a day of activity watches in real time.
  queueOptions: { retryLimit: 0, expireInSeconds: 2 * 60 * 60 },
  async handle(_job, { config }) {
    if (config.demo === undefined) return;
    const pool = new Pool({ connectionString: config.demo.ownerDatabaseUrl });
    try {
      const summary = await runDemoActivity(
        pool,
        { apiBaseUrl: config.demo.apiBaseUrl, password: config.demo.password },
        console.log,
      );
      console.log(`[demo-activity] ${summary}`);
    } finally {
      await pool.end();
    }
  },
});
