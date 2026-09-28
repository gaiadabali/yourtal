import type { PgBoss } from "pg-boss";
import { defineQueue } from "@yourtal/queue/define-queue";
import { sendIdempotent } from "@yourtal/queue/send-idempotent";
import {
  WEBHOOK_DELIVERY_QUEUE,
  webhookDeliveryEventSchema,
} from "@yourtal/contracts/device/webhook-delivery-event";
import type { WebhookDeliveryEvent } from "@yourtal/contracts/device/webhook-delivery-event";

/**
 * TASKS.md 8.3.c's producer half — `apps/worker/src/jobs/webhook-delivery.ts`
 * is the consumer. Same shape `campaign-published-publisher.ts` (7.3.f)
 * already established: `defineQueue` runs on every publish so this never
 * depends on the worker process having created the queue first.
 */
export interface WebhookEventPublisher {
  publish(event: WebhookDeliveryEvent): Promise<void>;
}

export const WEBHOOK_EVENT_PUBLISHER = Symbol("WEBHOOK_EVENT_PUBLISHER");

export class PgBossWebhookEventPublisher implements WebhookEventPublisher {
  constructor(private readonly boss: PgBoss) {}

  async publish(event: WebhookDeliveryEvent): Promise<void> {
    const parsed = webhookDeliveryEventSchema.parse(event);
    await defineQueue(this.boss, WEBHOOK_DELIVERY_QUEUE);
    await sendIdempotent(this.boss, WEBHOOK_DELIVERY_QUEUE, parsed);
  }
}
