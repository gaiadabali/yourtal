import type { PaymentEvent } from "@yourtal/drivers/payments";
import { referenceId } from "../../payments/payment-event-handlers";
import type { PaymentEventHandlers } from "../../payments/payment-event-handlers";
import type { CardPurchaseRepository } from "../persistence/card-purchase.repository";
import type { CardPurchaseRefundRepository } from "../persistence/card-purchase-refund.repository";
import { fulfilPurchase } from "./fulfil-purchase.use-case";
import type { FulfilDeps } from "./fulfil-purchase.use-case";
import { PURCHASE_PREFIX } from "./start-purchase.use-case";

type Deps = FulfilDeps & {
  readonly purchases: Pick<CardPurchaseRepository, "markExpired">;
  readonly refunds: Pick<CardPurchaseRefundRepository, "settleFromEvent">;
};

/**
 * Billing's webhook subscriptions: a paid checkout grants the points, an
 * expired one closes the purchase, and a refund staff asked for (5.1.g) marks
 * its parked purchase refunded, once. Events for anything but a card purchase
 * (a card setup, an auction) are left to their own handlers.
 */
export function registerPurchaseEvents(handlers: PaymentEventHandlers, deps: Deps): void {
  handlers.on("checkout.completed", async (event) => {
    if (event.mode !== "payment") return;
    await onPaid(deps, event);
  });
  handlers.on("checkout.expired", async (event) => {
    const id = referenceId(event.reference, PURCHASE_PREFIX);
    if (id === null) return;
    const row = await deps.purchases.find(id);
    if (row === null || (row.checkoutRef !== null && row.checkoutRef !== event.checkoutReference))
      return;
    await deps.purchases.markExpired(id);
  });
  // Matched by the payment it refunds; a payment that is not a parked purchase of ours changes nothing.
  handlers.on("refund.succeeded", async (event) => {
    await deps.refunds.settleFromEvent(event.paymentReference, event.refundReference);
  });
}

async function onPaid(
  deps: Deps,
  event: Extract<PaymentEvent, { type: "checkout.completed" }>,
): Promise<void> {
  const id = referenceId(event.reference, PURCHASE_PREFIX);
  if (id === null) return;
  const row = await deps.purchases.find(id);
  if (row === null) return;
  if (row.checkoutRef !== null && row.checkoutRef !== event.checkoutReference) {
    // Money arrived through a checkout this purchase did not open: keep it and let staff look.
    await deps.purchases.markNeedsReview(
      row.id,
      event.paymentReference,
      `paid through checkout ${event.checkoutReference}, expected ${row.checkoutRef}`,
    );
    return;
  }
  await fulfilPurchase(deps, row, {
    amountMinor: event.amountMinor,
    currency: event.currency,
    paymentRef: event.paymentReference,
  });
}
