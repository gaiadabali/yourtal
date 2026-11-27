import { SPAMBANK_QUEUES, spambankAutoreplyJobSchema } from "@yourtal/contracts/spambank/events";
import { runAutoreply } from "../../../api/src/modules/spambank/autoreply/run-autoreply";
import { defineJob } from "../job";
import { spambankAutoreplyDeps } from "../spambank-runtime";

/**
 * Spambank's counter-spam reply (BUILD.md F4, §4.6): one message, every safeguard checked again, at most
 * one reply. A job that fires twice, or one the sweep re-queues, finds the decision taken and stops.
 */
export const job = defineJob({
  queue: SPAMBANK_QUEUES.autoreply,
  async handle(queued, { config }) {
    const data = spambankAutoreplyJobSchema.safeParse(queued.data);
    if (!data.success) {
      console.error(
        `[spambank] autoreply: job ${queued.id} has no valid mailboxId/emailId; dropped`,
      );
      return;
    }
    const result = await runAutoreply(spambankAutoreplyDeps(config), data.data);
    if (
      result.status === "decided" &&
      ["sent", "redirected", "send_failed"].includes(result.decision)
    ) {
      console.error(
        `[spambank] autoreply ${data.data.mailboxId}/${data.data.emailId}: ${result.decision}`,
      );
    }
  },
});
