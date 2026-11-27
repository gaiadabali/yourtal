import { SPAMBANK_QUEUES, spambankIngestJobSchema } from "@yourtal/contracts/spambank/events";
import { ingestMailbox } from "../../../api/src/modules/spambank/ingest/ingest-mailbox";
import { defineJob } from "../job";
import { afterIngest, spambankIngestDeps } from "../spambank-runtime";

/**
 * Spambank (BUILD.md F3): the webhook says "mail arrived for this mailbox"; this reads it. The webhook is
 * only a nudge (the reconcile covers every mailbox each minute), so a job for a mailbox that is gone, not
 * active, or already being read by another run simply finishes.
 */

export const job = defineJob({
  queue: SPAMBANK_QUEUES.ingest,
  async handle(queued, { boss, config }) {
    const data = spambankIngestJobSchema.safeParse(queued.data);
    if (!data.success) {
      console.error(`[spambank] ingest: job ${queued.id} has no valid mailboxId; dropped`);
      return;
    }
    const result = await ingestMailbox(spambankIngestDeps(config), data.data.mailboxId);
    await afterIngest(boss, data.data.mailboxId, result);
  },
});
