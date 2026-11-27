import { defineJob } from "../job";
import { SPAMBANK_QUEUES } from "@yourtal/contracts/spambank/events";
import { reconcileMailboxes } from "../../../api/src/modules/spambank/ingest/reconcile";
import { afterIngest, kickEventDelivery, spambankIngestDeps } from "../spambank-runtime";

/**
 * Spambank (BUILD.md B5): every minute, read the new mail of every active mailbox. The webhook only makes
 * this faster; if it never fires, or its payload is not understood, mail is still processed within a minute.
 * With no Spambank mailboxes this is one empty query.
 */
export const job = defineJob({
  queue: SPAMBANK_QUEUES.reconcile,
  schedule: "* * * * *",
  async handle(_queued, { boss, config }) {
    const result = await reconcileMailboxes(spambankIngestDeps(config));
    if (result.mailboxes > 0 || result.unavailable > 0) {
      console.error(
        `[spambank] reconcile: ${String(result.mailboxes)} mailbox(es), ${String(result.processed)} new message(s)` +
          (result.stalwartDown ? ", stopped early: Stalwart is not answering" : ""),
      );
    }
    const perMailbox = new Map<string, string[]>();
    for (const { mailboxId, emailId } of result.autoreplies) {
      perMailbox.set(mailboxId, [...(perMailbox.get(mailboxId) ?? []), emailId]);
    }
    for (const [mailboxId, emailIds] of perMailbox) {
      await afterIngest(boss, mailboxId, { autoreplyEmailIds: emailIds, eventsQueued: 0 });
    }
    // One kick for all the events the run wrote, rather than one per mailbox.
    if (result.eventsQueued > 0) await kickEventDelivery(boss);
  },
});
