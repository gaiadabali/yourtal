import { SPAMBANK_QUEUES } from "@yourtal/contracts/spambank/events";
import { sweepAutoreplies } from "../../../api/src/modules/spambank/autoreply/sweep";
import { defineJob } from "../job";
import { loadSpambankConfig, sendAutoreplyJob, spambankPool } from "../spambank-runtime";

/** T6's follow-up: messages left `queued` whose auto-reply job was lost get a new one (sweep.ts). */
export const job = defineJob({
  queue: SPAMBANK_QUEUES.autoreplySweep,
  schedule: "*/5 * * * *",
  async handle(_queued, { boss, config }) {
    const result = await sweepAutoreplies(
      spambankPool(config),
      loadSpambankConfig().autoreply.mode,
      new Date(),
    );
    for (const lost of result.requeue) await sendAutoreplyJob(boss, lost);
    if (result.requeue.length + result.stale + result.interrupted + result.disabled > 0) {
      console.error(
        `[spambank] autoreply sweep: ${String(result.requeue.length)} re-queued, ${String(result.stale)} stale, ` +
          `${String(result.interrupted)} interrupted, ${String(result.disabled)} disabled`,
      );
    }
  },
});
