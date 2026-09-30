import { describe, expect, it } from "vitest";
import { createSimulatedMarketplacePayments } from "./marketplace-payments";

describe("simulated marketplace payments (13.22)", () => {
  it("holds, then captures into the charity's destination, with stable references", async () => {
    const payments = createSimulatedMarketplacePayments();
    const hold = await payments.hold({
      idempotencyKey: "bid-1",
      amountMinor: 1250,
      currency: "AUD",
      reference: "auction:a",
    });
    expect(hold._unsafeUnwrap().providerAmount).toBe(1250);
    const again = await payments.hold({
      idempotencyKey: "bid-1",
      amountMinor: 1250,
      currency: "AUD",
      reference: "auction:a",
    });
    expect(again._unsafeUnwrap().holdReference).toBe(hold._unsafeUnwrap().holdReference);

    const capture = await payments.capture({
      idempotencyKey: "capture-a",
      holdReference: hold._unsafeUnwrap().holdReference,
      amountMinor: 1250,
      currency: "AUD",
      destinationReference: "simpayout_charity",
    });
    expect(capture._unsafeUnwrap().destinationReference).toBe("simpayout_charity");
  });

  it("speaks whole rupiah for IDR and refuses a capture with no destination", async () => {
    const payments = createSimulatedMarketplacePayments();
    const hold = await payments.hold({
      idempotencyKey: "bid-2",
      amountMinor: 25000,
      currency: "IDR",
      reference: "auction:b",
    });
    expect(hold._unsafeUnwrap().providerAmount).toBe(25000);
    const capture = await payments.capture({
      idempotencyKey: "capture-b",
      holdReference: hold._unsafeUnwrap().holdReference,
      amountMinor: 25000,
      currency: "IDR",
      destinationReference: " ",
    });
    expect(capture.isErr()).toBe(true);
  });

  it("declines a hold when the fault plan says so", async () => {
    const payments = createSimulatedMarketplacePayments({ kind: "decline" });
    const hold = await payments.hold({
      idempotencyKey: "bid-3",
      amountMinor: 100,
      currency: "AUD",
      reference: "auction:c",
    });
    expect(hold.isErr()).toBe(true);
  });
});
