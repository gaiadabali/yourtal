import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CARD_3DS,
  CARD_DECLINED,
  CARD_OK,
  type Harness,
  URLS,
  paidPurchase,
  savedCard,
  startHarness,
} from "./paysim-harness";

/**
 * 5.1.c: the real Stripe payments driver against the payment simulation, end to end over HTTP. Webhooks arrive at
 * a local receiver and are verified and normalised by the driver's own parseWebhook.
 */

let h: Harness;
beforeEach(async () => {
  h = await startHarness();
});
afterEach(async () => {
  await h.close();
});

async function startPurchase(key: string, amountMinor = 4_500, expiresAt?: Date) {
  const started = (
    await h.payments.startCheckout({
      idempotencyKey: `purchase:${key}`,
      amountMinor,
      currency: "AUD",
      reference: `card-purchase:${key}`,
      description: "10,000 YourTal points",
      locale: "en",
      ...URLS,
      ...(expiresAt === undefined ? {} : { expiresAt }),
    })
  )._unsafeUnwrap();
  if (started.kind !== "redirect") throw new Error("Stripe checkout redirects");
  return started;
}

describe("a points purchase through Checkout", () => {
  it("4242 pays: checkout.completed carries our reference and the amount in OUR units", async () => {
    const started = await startPurchase("p1");
    expect(started.url).toBe(`${h.sim.config.publicBaseUrl}/checkout/${started.checkoutReference}`);
    const page = await h.browser.submitCheckout(started.checkoutReference, CARD_OK);
    expect(page.status).toBe(303);
    expect(page.location).toBe(`https://app.test/ok?s=${started.checkoutReference}`);

    const events = await h.deliver();
    const completed = events.find((event) => event.type === "checkout.completed");
    expect(completed).toMatchObject({
      checkoutReference: started.checkoutReference,
      mode: "payment",
      reference: "card-purchase:p1",
      amountMinor: 4_500,
      currency: "AUD",
    });
    const paymentReference =
      completed?.type === "checkout.completed" ? completed.paymentReference : null;
    expect(paymentReference).toMatch(/^pi_/);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "payment.succeeded",
        paymentReference,
        reference: "card-purchase:p1",
        amountMinor: 4_500,
      }),
    );
  });

  it("0002 is declined: no completed checkout, a payment.failed with the decline code", async () => {
    const started = await startPurchase("p2");
    const page = await h.browser.submitCheckout(started.checkoutReference, CARD_DECLINED);
    expect(page.html).toContain("Your card was declined.");
    const events = await h.deliver();
    expect(events.some((event) => event.type === "checkout.completed")).toBe(false);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "payment.failed",
        reference: "card-purchase:p2",
        code: "generic_decline",
      }),
    );
  });

  it("3155 asks for 3-D Secure: completing it pays", async () => {
    const started = await startPurchase("p3");
    await h.browser.submitCheckout(started.checkoutReference, CARD_3DS);
    expect((await h.deliver()).some((event) => event.type === "checkout.completed")).toBe(false);
    const decided = await h.browser.decideThreeDS(started.checkoutReference, "complete");
    expect(decided.status).toBe(303);
    expect(await h.deliver()).toContainEqual(
      expect.objectContaining({
        type: "checkout.completed",
        reference: "card-purchase:p3",
        amountMinor: 4_500,
      }),
    );
  });

  it("3155 with authentication failed does not pay", async () => {
    const started = await startPurchase("p4");
    await h.browser.submitCheckout(started.checkoutReference, CARD_3DS);
    const decided = await h.browser.decideThreeDS(started.checkoutReference, "fail");
    expect(decided.html).toContain("We are unable to authenticate your payment method.");
    const events = await h.deliver();
    expect(events.some((event) => event.type === "checkout.completed")).toBe(false);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "payment.failed",
        code: "payment_intent_authentication_failure",
      }),
    );
  });

  it("expiresAt reaches the session, and the sweep expires it into checkout.expired", async () => {
    const expiresAt = new Date(h.now().getTime() + 30 * 60_000);
    const started = await startPurchase("p5", 4_500, expiresAt);
    const session = await h.recorded(started.checkoutReference);
    expect(session.expires_at).toBe(expiresAt.getTime() / 1_000);

    h.advance(30 * 60_000);
    expect(await h.deliver()).toContainEqual({
      type: "checkout.expired",
      eventId: expect.stringMatching(/^evt_/),
      checkoutReference: started.checkoutReference,
      reference: "card-purchase:p5",
    });
  });

  it("replays the same session for the same idempotency key", async () => {
    const first = await startPurchase("p6");
    const again = await startPurchase("p6");
    expect(again).toStrictEqual(first);
  });
});

describe("a saved card for boosts", () => {
  it("saves 4242 through setup-mode Checkout, then charges it off-session", async () => {
    const saved = await savedCard(h, "b1");
    expect(saved.customerRef).toMatch(/^cus_/);
    expect(saved.paymentMethodRef).toMatch(/^pm_/);
    expect(saved.card).toStrictEqual({ brand: "visa", last4: "4242", expMonth: 12, expYear: 2034 });
    expect(await h.deliver()).toContainEqual(
      expect.objectContaining({
        type: "checkout.completed",
        mode: "setup",
        checkoutReference: saved.checkoutReference,
        reference: "card-setup:b1",
        customerRef: saved.customerRef,
        amountMinor: null,
      }),
    );

    const charged = (
      await h.payments.chargeSaved({
        idempotencyKey: "boost-day:b1",
        amountMinor: 1_250,
        currency: "AUD",
        customerRef: saved.customerRef,
        paymentMethodRef: saved.paymentMethodRef,
        reference: "boost-day:b1",
        description: "Boost",
      })
    )._unsafeUnwrap();
    expect(charged.status).toBe("succeeded");
    expect(await h.deliver()).toContainEqual(
      expect.objectContaining({
        type: "payment.succeeded",
        paymentReference: charged.paymentReference,
        amountMinor: 1_250,
      }),
    );
  });

  it("refuses an amount under minimumChargeMinor without calling the simulation", async () => {
    const saved = await savedCard(h, "b2");
    const before = h.apiCalls.length;
    const small = await h.payments.chargeSaved({
      idempotencyKey: "boost-day:b2",
      amountMinor: (h.payments.minimumChargeMinor.AUD ?? 0) - 1,
      currency: "AUD",
      customerRef: saved.customerRef,
      paymentMethodRef: saved.paymentMethodRef,
      reference: "boost-day:b2",
    });
    expect(small._unsafeUnwrapErr()).toMatchObject({ kind: "declined", mayHaveSucceeded: false });
    expect(h.apiCalls.length).toBe(before);
  });
});

describe("refunds", () => {
  it("refunds part, then the rest, with a refund.succeeded each time; more is refused", async () => {
    const { paymentReference } = await paidPurchase(h, "r1", 4_500);
    const part = await h.payments.refund({
      idempotencyKey: "refund:r1:1",
      paymentReference,
      currency: "AUD",
      amountMinor: 1_000,
      reference: "refund:r1:1",
    });
    const rest = await h.payments.refund({
      idempotencyKey: "refund:r1:2",
      paymentReference,
      currency: "AUD",
      reference: "refund:r1:2",
    });
    expect(part._unsafeUnwrap().status).toBe("succeeded");
    expect(rest._unsafeUnwrap().status).toBe("succeeded");

    const refunds = (await h.deliver()).filter((event) => event.type === "refund.succeeded");
    expect(refunds).toHaveLength(2);
    expect(refunds).toContainEqual(
      expect.objectContaining({
        refundReference: part._unsafeUnwrap().refundReference,
        paymentReference,
        amountMinor: 1_000,
        currency: "AUD",
      }),
    );
    expect(refunds).toContainEqual(
      expect.objectContaining({
        refundReference: rest._unsafeUnwrap().refundReference,
        amountMinor: 3_500,
      }),
    );

    const more = await h.payments.refund({
      idempotencyKey: "refund:r1:3",
      paymentReference,
      currency: "AUD",
      amountMinor: 1,
      reference: "refund:r1:3",
    });
    expect(more._unsafeUnwrapErr()).toMatchObject({ kind: "declined", mayHaveSucceeded: false });
  });

  it("refuses refunding more than was paid", async () => {
    const { paymentReference } = await paidPurchase(h, "r2", 4_500);
    const over = await h.payments.refund({
      idempotencyKey: "refund:r2",
      paymentReference,
      currency: "AUD",
      amountMinor: 4_501,
      reference: "refund:r2",
    });
    expect(over._unsafeUnwrapErr()).toMatchObject({ kind: "declined", mayHaveSucceeded: false });
  });
});
