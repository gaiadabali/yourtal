import { describe, expect, it } from "vitest";
import { SIMULATED_CARD, createPaymentsDriver, createSimulatedPayments } from "./payments";
import { createSimulatedMarketplacePayments } from "./marketplace-payments";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from "./webhook-signature";

/** The 14.7 seam on the simulated (Xendit-shaped) driver: what ID runs, and what tests run everywhere. */

const NOW = 1_800_000_000_000;
const driver = () =>
  createPaymentsDriver("simulated", {}) as ReturnType<typeof createSimulatedPayments>;

describe("the simulated payments driver on the 14.7 seam", () => {
  it("needs no saved card and has no minimum beyond one minor unit", () => {
    const payments = driver();
    expect(payments.provider).toBe("simulated");
    expect(payments.needsSavedCard).toBe(false);
    expect(payments.minimumChargeMinor).toStrictEqual({ AUD: 1, IDR: 1 });
    expect(createSimulatedPayments().minimumChargeMinor).toStrictEqual({ AUD: 1 });
  });

  it("settles a checkout at once, and replays the first answer for the same key", async () => {
    const payments = driver();
    const request = {
      idempotencyKey: "card-purchase:1",
      amountMinor: 45_000,
      currency: "IDR" as const,
      reference: "card-purchase:1",
      description: "Points",
      successUrl: "s",
      cancelUrl: "c",
    };
    const first = (await payments.startCheckout(request))._unsafeUnwrap();
    expect(first.kind).toBe("paid");
    expect(await payments.startCheckout(request)).toStrictEqual(
      await payments.startCheckout(request),
    );
    expect((await payments.startCheckout(request))._unsafeUnwrap()).toStrictEqual(first);
  });

  it("saves the fixed fake card at once", async () => {
    const setup = await driver().startCardSetup({
      idempotencyKey: "setup:1",
      customerRef: "simcus_1",
      reference: "setup:1",
      currency: "AUD",
      successUrl: "s",
      cancelUrl: "c",
    });
    expect(setup._unsafeUnwrap()).toStrictEqual({
      kind: "saved",
      paymentMethodRef: "simpm_setup:1",
      card: SIMULATED_CARD,
    });
  });

  it("refuses cardSetupResult, which only a redirecting driver can answer", async () => {
    expect((await driver().cardSetupResult("cs_x"))._unsafeUnwrapErr().kind).toBe("declined");
  });

  it("accepts a customer, a saved-card charge and a refund", async () => {
    const payments = driver();
    expect(
      (await payments.createCustomer({ idempotencyKey: "c1", reference: "u1" }))._unsafeUnwrap(),
    ).toStrictEqual({
      customerRef: "simcus_c1",
    });
    const charged = await payments.chargeSaved({
      idempotencyKey: "boost:1",
      amountMinor: 30,
      currency: "AUD",
      customerRef: "simcus_c1",
      paymentMethodRef: "simpm_1",
      reference: "boost:1",
    });
    expect(charged._unsafeUnwrap()).toStrictEqual({
      paymentReference: "simpi_boost:1",
      status: "succeeded",
    });
    const refunded = await payments.refund({
      idempotencyKey: "refund:1",
      paymentReference: "simpi_boost:1",
      currency: "AUD",
      reference: "refund:1",
    });
    expect(refunded._unsafeUnwrap()).toStrictEqual({
      refundReference: "simre_refund:1",
      status: "succeeded",
    });
  });

  it("shapes the new calls with the fault plan, like the old one", async () => {
    const declining = createSimulatedPayments({ kind: "decline" });
    const charged = await declining.chargeSaved({
      idempotencyKey: "k",
      amountMinor: 100,
      currency: "AUD",
      customerRef: "c",
      paymentMethodRef: "p",
      reference: "r",
    });
    expect(charged._unsafeUnwrapErr().kind).toBe("declined");
  });
});

describe("the simulated driver's webhook on the seam", () => {
  async function settledDelivery() {
    const payments = driver();
    const charge = await payments.charge({
      idempotencyKey: "k1",
      amountMinor: 45_000,
      currency: "IDR",
      reference: "top-up-1",
    });
    const [pending, settled] = payments.signedDeliveries(
      charge._unsafeUnwrap().providerReference,
      NOW,
    );
    return { payments, pending, settled };
  }

  it("keeps the x-yourtal-signature scheme and normalises a settled callback", async () => {
    const { payments, settled } = await settledDelivery();
    const event = payments.parseWebhook(
      { rawBody: settled?.body ?? "", headers: settled?.headers ?? {} },
      NOW,
    );
    expect(event._unsafeUnwrap()).toStrictEqual({
      type: "payment.succeeded",
      eventId: "sim_k1_2",
      paymentReference: "sim_k1",
      reference: "top-up-1",
      amountMinor: 45_000,
      currency: "IDR",
    });
  });

  it("ignores the pending callback and refuses a tampered or unsigned one", async () => {
    const { payments, pending, settled } = await settledDelivery();
    expect(
      payments
        .parseWebhook({ rawBody: pending?.body ?? "", headers: pending?.headers ?? {} }, NOW)
        ._unsafeUnwrap(),
    ).toMatchObject({
      type: "ignored",
      providerType: "pending",
    });
    const tampered = (settled?.body ?? "").replace("45000", "4500000");
    expect(
      payments
        .parseWebhook({ rawBody: tampered, headers: settled?.headers ?? {} }, NOW)
        ._unsafeUnwrapErr().kind,
    ).toBe("bad_signature");
    expect(
      payments
        .parseWebhook(
          { rawBody: settled?.body ?? "", headers: { [TIMESTAMP_HEADER]: String(NOW) } },
          NOW,
        )
        ._unsafeUnwrapErr().kind,
    ).toBe("missing_signature");
    expect(SIGNATURE_HEADER).toBe("x-yourtal-signature");
  });
});

describe("the simulated marketplace on the seam", () => {
  it("needs no saved card and still releases by a bare hold reference or a request", async () => {
    const market = createSimulatedMarketplacePayments();
    expect(market.needsSavedCard).toBe(false);
    expect(market.declaredMinorUnitExponent).toStrictEqual({ AUD: 2, IDR: 0 });
    expect((await market.release("simhold_1")).isOk()).toBe(true);
    expect((await market.release({ idempotencyKey: "r", holdReference: "simhold_1" })).isOk()).toBe(
      true,
    );
  });
});
