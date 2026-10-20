import { describe, expect, it, vi } from "vitest";
import { PaymentEventHandlers } from "../payments/payment-event-handlers";
import { registerAuctionPaymentEvents } from "./auction-payment-events";

const canceled = (paymentReference: string) => ({
  type: "payment.canceled" as const,
  eventId: `evt_${paymentReference}`,
  paymentReference,
  reference: "auction:6f0e1d1a-3b7e-4c55-9d43-2b1d2d1f0a01",
  reason: "automatic",
});

describe("a cancelled hold (5.1.d)", () => {
  it("marks the bid's hold released by its payment reference", async () => {
    const handlers = new PaymentEventHandlers();
    const markHoldCanceled = vi.fn().mockResolvedValue(true);
    registerAuctionPaymentEvents(handlers, { markHoldCanceled });
    expect(await handlers.dispatch(canceled("pi_1"))).toBe(1);
    expect(markHoldCanceled).toHaveBeenCalledWith("pi_1");
  });

  it("tolerates a payment that is not a bid's hold, and a replay", async () => {
    const handlers = new PaymentEventHandlers();
    const markHoldCanceled = vi.fn().mockResolvedValue(false);
    registerAuctionPaymentEvents(handlers, { markHoldCanceled });
    await handlers.dispatch(canceled("pi_not_ours"));
    await handlers.dispatch(canceled("pi_not_ours"));
    expect(markHoldCanceled).toHaveBeenCalledTimes(2);
  });

  it("ignores every other event type", async () => {
    const handlers = new PaymentEventHandlers();
    const markHoldCanceled = vi.fn();
    registerAuctionPaymentEvents(handlers, { markHoldCanceled });
    const failed = {
      type: "payment.failed" as const,
      eventId: "evt_f",
      paymentReference: "pi_1",
      reference: null,
      code: null,
    };
    expect(await handlers.dispatch(failed)).toBe(0);
    expect(markHoldCanceled).not.toHaveBeenCalled();
  });
});
