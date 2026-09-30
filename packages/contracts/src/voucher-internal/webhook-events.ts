import * as z from "zod";
import { webhookEventTypeSchema } from "../merchant/merchant-developer-credential";

/**
 * TASKS.md 8.3.e: apps/worker's poll-then-acknowledge pair over
 * voucher.webhook_outbox (services/voucher/internal/api/webhook_routes.go),
 * the same shape ledger-internal/releases.ts's unnotified/notified pair
 * uses for holdback releases. Every capture, refund and (once 10.2.b exists)
 * expiry the voucher service settles writes one of these, in the same
 * transaction as the state change; apps/worker drains them onto the 8.3.c
 * webhook-delivery queue.
 */

export const webhookOutboxEventSchema = z.object({
  id: z.uuid(),
  eventType: webhookEventTypeSchema,
  /** The business the event notifies — services/voucher's merchant id IS the business id (4.5.d). */
  merchantId: z.uuid(),
  idempotencyKey: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});
export type WebhookOutboxEvent = z.infer<typeof webhookOutboxEventSchema>;

export const unpostedWebhookEventsRequestSchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
});
export type UnpostedWebhookEventsRequest = z.infer<typeof unpostedWebhookEventsRequestSchema>;

/** Oldest event first. */
export const unpostedWebhookEventsSchema = z.object({
  events: z.array(webhookOutboxEventSchema),
});
export type UnpostedWebhookEvents = z.infer<typeof unpostedWebhookEventsSchema>;

export const webhookEventsPostedRequestSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(500),
});
export type WebhookEventsPostedRequest = z.infer<typeof webhookEventsPostedRequestSchema>;

/** How many were newly recorded; a repeat or an unknown id counts 0. */
export const webhookEventsPostedSchema = z.object({
  acknowledged: z.number().int().min(0),
});
export type WebhookEventsPosted = z.infer<typeof webhookEventsPostedSchema>;
