import { Logger } from "@nestjs/common";
import type { PaymentEventHandlers } from "../payments/payment-event-handlers";
import type { AuctionStore } from "./persistence/auction-store";

/**
 * A provider cancelling a hold (Stripe's 7-day sweep, `automatic`, or any other
 * cancellation) releases that bid's hold, so settlement never tries to capture
 * or release it. Idempotent, and an event for a payment that is not a bid's hold
 * changes nothing: one event reaches every handler of its type.
 */
export function registerAuctionPaymentEvents(
  handlers: PaymentEventHandlers,
  store: Pick<AuctionStore, "markHoldCanceled">,
): void {
  const logger = new Logger("AuctionPaymentEvents");
  handlers.on("payment.canceled", async (event) => {
    if (await store.markHoldCanceled(event.paymentReference)) {
      logger.log(
        `bid hold ${event.paymentReference} was cancelled (${event.reason ?? "no reason"})`,
      );
    }
  });
}
