import type { PgBoss } from "pg-boss";
import {
  WEBHOOK_DELIVERY_QUEUE,
  webhookDeliveryEventSchema,
} from "@yourtal/contracts/device/webhook-delivery-event";
import type { WebhookDeliveryEvent } from "@yourtal/contracts/device/webhook-delivery-event";
import { defineQueue } from "@yourtal/queue/define-queue";
import { sendIdempotent } from "@yourtal/queue/send-idempotent";
import { defineJob } from "../job";
import { createWorkerVoucherClient } from "../voucher-client";
import type { WorkerVoucherClient } from "../voucher-client";

/**
 * TASKS.md 8.3.e: services/voucher is the single source of
 * `voucher.captured`/`refunded`/`expired` — its capture, refund and (once
 * 10.2.b exists) expiry transitions each write an outbox row in the same
 * transaction as the state change (voucher.webhook_outbox). This job lists
 * the rows nobody has drained, hands each to the SAME 8.3.c delivery queue
 * `webhook-event-publisher.ts` (apps/api) already publishes onto, then
 * acknowledges — the same list-then-acknowledge shape `points-unlocked.ts`
 * uses for the ledger's holdback releases.
 *
 * `merchantId` on the voucher side IS the business id (4.5.d: Studio issues
 * a merchant credential with `merchantId: businessId`), so no lookup is
 * needed to fill `WebhookDeliveryEvent.businessId`.
 *
 * `sendIdempotent` does not derive a stable pg-boss job id (unlike
 * `points-unlocked.ts`'s `unlockJobId`) — webhook-event-publisher.ts
 * already relies on the delivery job's own dedup instead
 * (`platform.sim_outbox`'s `(boundary, idempotency_key)` uniqueness, that
 * job's own header explains why), so a row drained twice after a crash
 * between `webhookEventsPosted` and the next tick still delivers at most
 * once.
 */
const PAGE_SIZE = 100;
/** Bounds one tick; whatever is left goes on the next. */
const MAX_PAGES = 20;

const defined = new WeakSet<PgBoss>();

/** Returns how many outbox rows this call drained. */
export async function drainWebhookOutbox(
  boss: PgBoss,
  vouchers: WorkerVoucherClient,
  pageSize = PAGE_SIZE,
): Promise<number> {
  if (!defined.has(boss)) {
    await defineQueue(boss, WEBHOOK_DELIVERY_QUEUE);
    defined.add(boss);
  }
  let drained = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { events } = await vouchers.unpostedWebhookEvents(pageSize);
    if (events.length === 0) break;
    for (const event of events) {
      const delivery: WebhookDeliveryEvent = webhookDeliveryEventSchema.parse({
        businessId: event.merchantId,
        eventType: event.eventType,
        payload: event.payload,
        idempotencyKey: event.idempotencyKey,
      });
      await sendIdempotent(boss, WEBHOOK_DELIVERY_QUEUE, delivery);
    }
    // Only after every send: a crash in between re-drains the same page,
    // never skips one.
    await vouchers.webhookEventsPosted(events.map((event) => event.id));
    drained += events.length;
    if (events.length < pageSize) break;
  }
  return drained;
}

export const job = defineJob({
  queue: "voucher.webhook_outbox_drain",
  schedule: "* * * * *",
  async handle(_job, { boss, config }) {
    await drainWebhookOutbox(boss, createWorkerVoucherClient(config.voucher));
  },
});
