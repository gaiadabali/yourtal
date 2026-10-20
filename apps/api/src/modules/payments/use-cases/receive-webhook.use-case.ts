import type { PaymentsDriver, WebhookDelivery } from "@yourtal/drivers/payments";
import type { PaymentEventHandlers } from "../payment-event-handlers";
import type { ProviderEventRepository } from "../provider-event.repository";

export type WebhookOutcome =
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "duplicate"; readonly eventId: string }
  | {
      readonly kind: "handled";
      readonly eventId: string;
      readonly type: string;
      readonly handlers: number;
    };

/**
 * One delivery: verify the signature on the raw body, claim the event id,
 * run the handlers, then mark it done. A handler that throws leaves the claim
 * open and rejects, so the caller answers 500 and the sender retries; every
 * handler is idempotent, so the retry is safe.
 */
export async function receiveWebhook(
  deps: {
    readonly driver: Pick<PaymentsDriver, "parseWebhook" | "provider">;
    readonly events: Pick<ProviderEventRepository, "claim" | "markProcessed">;
    readonly handlers: Pick<PaymentEventHandlers, "dispatch">;
  },
  delivery: WebhookDelivery,
  nowMs: number,
): Promise<WebhookOutcome> {
  const parsed = deps.driver.parseWebhook(delivery, nowMs);
  if (parsed.isErr()) {
    const refusal = parsed.error;
    return { kind: "refused", reason: refusal.kind };
  }
  const event = parsed.value;
  const type = event.type === "ignored" ? event.providerType : event.type;
  if (await deps.events.claim(event.eventId, deps.driver.provider, type)) {
    return { kind: "duplicate", eventId: event.eventId };
  }
  const handlers = event.type === "ignored" ? 0 : await deps.handlers.dispatch(event);
  await deps.events.markProcessed(event.eventId);
  return { kind: "handled", eventId: event.eventId, type, handlers };
}
