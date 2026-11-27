import { SPAMBANK_QUEUES } from "@yourtal/contracts/spambank/events";
import { purgeSpambank } from "../../../api/src/modules/spambank/ingest/purge";
import { defineJob } from "../job";
import { spambankPool } from "../spambank-runtime";

/** Spambank (BUILD.md §6): ingest bookkeeping older than 30 days goes, hourly. */
export const job = defineJob({
  queue: SPAMBANK_QUEUES.purge,
  schedule: "17 * * * *",
  async handle(_queued, { config }) {
    const result = await purgeSpambank(spambankPool(config));
    if (result.ingestedMessages + result.statementOffers + result.appEvents > 0) {
      console.error(
        `[spambank] purge: ${String(result.ingestedMessages)} ingested, ` +
          `${String(result.statementOffers)} offers, ${String(result.appEvents)} events`,
      );
    }
  },
});
