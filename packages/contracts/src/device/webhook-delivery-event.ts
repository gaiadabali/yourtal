import { z } from "zod";
import { webhookEventTypeSchema } from "../merchant/merchant-developer-credential";

/**
 * TASKS.md 8.3.c: `apps/api`'s producer half (wherever a capture/refund/
 * expiry actually happens) publishes one of these; `apps/worker/src/jobs/
 * webhook-delivery.ts` is the one consumer. Same queue+event shape
 * `campaign-published-event.ts` (7.3.f) already established.
 */
export const WEBHOOK_DELIVERY_QUEUE = "webhook.delivery";

export const webhookDeliveryEventSchema = z.object({
  businessId: z.uuid(),
  eventType: webhookEventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  /** One delivery attempt per (businessId, eventType, this key) — a capture/refund/expiry's own id. */
  idempotencyKey: z.string().min(1),
});
export type WebhookDeliveryEvent = z.infer<typeof webhookDeliveryEventSchema>;
