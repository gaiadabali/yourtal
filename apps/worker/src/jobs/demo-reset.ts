import { Pool } from "pg";
import { runDemoActivity } from "@yourtal/db/demo-world/activity";
import { runDemoMarketplace } from "@yourtal/db/demo-world/marketplace";
import { resetDemoWorld } from "@yourtal/db/demo-world/reset";
import { defineJob } from "../job";

/**
 * 13.1.a: the staff console's "Reset demo world" button sends this job. It
 * rebuilds the demo world and its logins, then plays the first day of history.
 * Never retried: a half-finished reset is re-run by pressing the button again.
 */
export const DEMO_RESET_QUEUE = "demo-reset";

export const job = defineJob({
  queue: DEMO_RESET_QUEUE,
  // A reset renders video and a day of activity watches in real time.
  queueOptions: { retryLimit: 0, expireInSeconds: 2 * 60 * 60 },
  async handle(_job, { config }) {
    if (config.demo === undefined) {
      console.log("[demo-reset] skipped: no demo configuration here (or production)");
      return;
    }
    const pool = new Pool({ connectionString: config.demo.ownerDatabaseUrl });
    try {
      const result = await resetDemoWorld(
        pool,
        {
          ledger: config.ledger,
          voucher: config.voucher,
          password: config.demo.password,
          reviewPassword: config.demo.reviewPassword,
          siteUrl: config.demo.siteUrl,
        },
        console.log,
      );
      console.log(
        `[demo-reset] ${String(result.logins.length)} logins, ${String(result.funded)} funded`,
      );
      await runDemoMarketplace(
        {
          apiBaseUrl: config.demo.apiBaseUrl,
          password: config.demo.password,
          reviewPassword: config.demo.reviewPassword,
        },
        console.log,
      );
      const summary = await runDemoActivity(
        pool,
        {
          apiBaseUrl: config.demo.apiBaseUrl,
          password: config.demo.password,
          reviewPassword: config.demo.reviewPassword,
        },
        console.log,
      );
      console.log(`[demo-reset] activity: ${summary}`);
    } finally {
      await pool.end();
    }
  },
});
