import { SPAMBANK_QUEUES } from "@yourtal/contracts/spambank/events";
import { processReplyInbox } from "../../../api/src/modules/spambank/autoreply/reply-inbox";
import { defineJob } from "../job";
import {
  loadSpambankConfig,
  spambankAlerter,
  spambankDriver,
  spambankPool,
} from "../spambank-runtime";

/**
 * Bounces, complaints and answers to the reply domain's system addresses (BUILD.md §4.6). Queued by the
 * webhook when such mail arrives, and every minute regardless (T6's follow-up: the webhook is a nudge).
 */
export const job = defineJob({
  queue: SPAMBANK_QUEUES.replyInbox,
  schedule: "* * * * *",
  async handle(_queued, { config }) {
    const result = await processReplyInbox({
      pool: spambankPool(config),
      driver: spambankDriver(),
      replyDomain: loadSpambankConfig().replyDomain,
      alerter: spambankAlerter(),
    });
    if (result.read > 0) {
      console.error(`[spambank] reply-inbox: ${JSON.stringify(result.counted)}`);
    }
  },
});
