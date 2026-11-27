import { SPAMBANK_QUEUES } from "@yourtal/contracts/spambank/events";
import { runHealth } from "../../../api/src/modules/spambank/autoreply/health";
import { defineJob } from "../job";
import {
  loadSpambankConfig,
  spambankAlerter,
  spambankDriver,
  spambankPool,
} from "../spambank-runtime";

/** System accounts, the env daily cap, the auto-pause thresholds and housekeeping (health.ts). */
export const job = defineJob({
  queue: SPAMBANK_QUEUES.health,
  schedule: "*/5 * * * *",
  async handle(_queued, { config }) {
    const settings = loadSpambankConfig();
    await runHealth({
      db: spambankPool(config),
      driver: spambankDriver(),
      replyDomain: settings.replyDomain,
      quotaBytes: settings.quotaBytes,
      dailyCap: settings.autoreply.dailyCap,
      alerter: spambankAlerter(),
      now: new Date(),
    });
  },
});
