import { describe, expect, it } from "vitest";
import { createStripePayments, createStripePaymentsFromEnv } from "./stripe-payments";
import {
  type ScriptedAnswer,
  TEST_BASE,
  TEST_KEY,
  formLines,
  recordingFetch,
} from "./stripe-fetch-double";
import { signStripePayload } from "./stripe-signature";

const WEBHOOK_SECRET = "whsec_test_1";

function driver(...answers: ScriptedAnswer[]) {
  const double = recordingFetch(...answers);
  const payments = createStripePayments({
    apiBase: TEST_BASE,
    secretKey: TEST_KEY,
    webhookSecret: WEBHOOK_SECRET,
    fetch: double.fetch,
  });
  return { payments, calls: double.calls };
}

const checkout = {
  idempotencyKey: "card-purchase:1",
  amountMinor: 4500,
  currency: "AUD" as const,
  reference: "card-purchase:1",
  description: "10,000 YourTal points",
  customerRef: "cus_1",
  successUrl: "https://app.test/billing/done?session={CHECKOUT_SESSION_ID}",
  cancelUrl: "https://app.test/billing",
  locale: "en" as const,
};

describe("the Stripe payments driver", () => {
  it("declares AUD cents, no IDR, Stripe's A$0.50 minimum, and needs a saved card", () => {
    const { payments } = driver();
    expect(payments.mode).toBe("live");
    expect(payments.provider).toBe("stripe");
    expect(payments.declaredMinorUnitExponent).toStrictEqual({ AUD: 2 });
    expect(payments.minimumChargeMinor).toStrictEqual({ AUD: 50 });
    expect(payments.needsSavedCard).toBe(true);
  });

  it("creates a customer carrying our reference", async () => {
    const { payments, calls } = driver({ status: 200, body: { id: "cus_1", object: "customer" } });
    const result = await payments.createCustomer({
      idempotencyKey: "customer:u1",
      reference: "user:u1",
      email: "brand@example.test",
      name: "Brand Pty Ltd",
    });
    expect(result._unsafeUnwrap()).toStrictEqual({ customerRef: "cus_1" });
    expect(calls[0]?.url).toBe(`${TEST_BASE}/v1/customers`);
    expect(calls[0]?.headers["Idempotency-Key"]).toBe("customer:u1");
    expect(formLines(calls[0]?.body)).toStrictEqual([
      "email=brand@example.test",
      "name=Brand Pty Ltd",
      "metadata[reference]=user:u1",
    ]);
  });

  it("starts a payment-mode Checkout Session with one line item and our reference everywhere", async () => {
    const { payments, calls } = driver({
      status: 200,
      body: {
        id: "cs_test_1",
        object: "checkout.session",
        url: "http://paysim.test/checkout/cs_test_1",
      },
    });
    const result = await payments.startCheckout(checkout);
    expect(result._unsafeUnwrap()).toStrictEqual({
      kind: "redirect",
      checkoutReference: "cs_test_1",
      url: "http://paysim.test/checkout/cs_test_1",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe(`${TEST_BASE}/v1/checkout/sessions`);
    expect(calls[0]?.headers["Idempotency-Key"]).toBe("card-purchase:1");
    expect(formLines(calls[0]?.body)).toStrictEqual([
      "mode=payment",
      "success_url=https://app.test/billing/done?session={CHECKOUT_SESSION_ID}",
      "cancel_url=https://app.test/billing",
      "client_reference_id=card-purchase:1",
      "customer=cus_1",
      "locale=en",
      "metadata[reference]=card-purchase:1",
      "line_items[0][price_data][currency]=aud",
      "line_items[0][price_data][unit_amount]=4500",
      "line_items[0][price_data][product_data][name]=10,000 YourTal points",
      "line_items[0][quantity]=1",
      "payment_intent_data[metadata][reference]=card-purchase:1",
      "payment_intent_data[description]=10,000 YourTal points",
    ]);
  });

  it("sends expiresAt as expires_at in unix seconds, right after locale", async () => {
    const { payments, calls } = driver({
      status: 200,
      body: { id: "cs_test_1", url: "http://paysim.test/checkout/cs_test_1" },
    });
    const expiresAt = new Date(1_800_001_800_500);
    const result = await payments.startCheckout({ ...checkout, expiresAt });
    expect(result.isOk()).toBe(true);
    const lines = formLines(calls[0]?.body);
    expect(lines.slice(4, 7)).toStrictEqual([
      "customer=cus_1",
      "locale=en",
      "expires_at=1800001800",
    ]);
    expect(lines.filter((line) => line.startsWith("expires_at="))).toHaveLength(1);
  });

  it("refuses, without calling Stripe, an amount below the minimum and any IDR amount", async () => {
    const { payments, calls } = driver({ status: 200, body: {} });
    const small = await payments.startCheckout({ ...checkout, amountMinor: 49 });
    expect(small._unsafeUnwrapErr()).toMatchObject({ kind: "declined", mayHaveSucceeded: false });
    const idr = await payments.startCheckout({ ...checkout, currency: "IDR", amountMinor: 45_000 });
    expect(idr._unsafeUnwrapErr().detail).toContain("No declared minor-unit exponent for IDR");
    const saved = await payments.chargeSaved({
      idempotencyKey: "boost:1",
      amountMinor: 30,
      currency: "AUD",
      customerRef: "cus_1",
      paymentMethodRef: "pm_1",
      reference: "boost:1",
    });
    expect(saved._unsafeUnwrapErr().kind).toBe("declined");
    expect(calls).toHaveLength(0);
  });

  it("starts a setup-mode Checkout Session for saving a card", async () => {
    const { payments, calls } = driver({
      status: 200,
      body: { id: "cs_test_2", url: "http://paysim.test/checkout/cs_test_2" },
    });
    const result = await payments.startCardSetup({
      idempotencyKey: "card-setup:1",
      customerRef: "cus_1",
      reference: "card-setup:1",
      currency: "AUD",
      successUrl: "https://app.test/cards/done",
      cancelUrl: "https://app.test/cards",
    });
    expect(result._unsafeUnwrap()).toMatchObject({
      kind: "redirect",
      checkoutReference: "cs_test_2",
    });
    expect(formLines(calls[0]?.body)).toStrictEqual([
      "mode=setup",
      "customer=cus_1",
      "currency=aud",
      "success_url=https://app.test/cards/done",
      "cancel_url=https://app.test/cards",
      "client_reference_id=card-setup:1",
      "metadata[reference]=card-setup:1",
      "setup_intent_data[metadata][reference]=card-setup:1",
    ]);
  });

  it("reads a completed setup: session (setup_intent expanded) then the payment method", async () => {
    const { payments, calls } = driver(
      {
        status: 200,
        body: {
          id: "cs_test_2",
          mode: "setup",
          status: "complete",
          customer: "cus_1",
          setup_intent: {
            id: "seti_1",
            status: "succeeded",
            payment_method: "pm_1",
            customer: "cus_1",
          },
        },
      },
      {
        status: 200,
        body: {
          id: "pm_1",
          type: "card",
          card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 },
        },
      },
    );
    const result = await payments.cardSetupResult("cs_test_2");
    expect(result._unsafeUnwrap()).toStrictEqual({
      customerRef: "cus_1",
      paymentMethodRef: "pm_1",
      card: { brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 },
    });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toStrictEqual([
      `GET ${TEST_BASE}/v1/checkout/sessions/cs_test_2?expand[]=setup_intent`,
      `GET ${TEST_BASE}/v1/payment_methods/pm_1`,
    ]);
  });

  it("fetches the SetupIntent itself when the session did not expand it", async () => {
    const { payments, calls } = driver(
      {
        status: 200,
        body: { mode: "setup", status: "complete", customer: "cus_1", setup_intent: "seti_1" },
      },
      { status: 200, body: { id: "seti_1", status: "succeeded", payment_method: "pm_1" } },
      {
        status: 200,
        body: { id: "pm_1", card: { brand: "visa", last4: "4242", exp_month: 1, exp_year: 2031 } },
      },
    );
    expect((await payments.cardSetupResult("cs_test_2")).isOk()).toBe(true);
    expect(calls[1]?.url).toBe(`${TEST_BASE}/v1/setup_intents/seti_1`);
  });

  it("refuses a setup that is not complete", async () => {
    const { payments } = driver({
      status: 200,
      body: { mode: "setup", status: "open", setup_intent: null },
    });
    expect((await payments.cardSetupResult("cs_test_2"))._unsafeUnwrapErr().kind).toBe("declined");
  });

  it("charges a saved card off-session with automatic capture", async () => {
    const { payments, calls } = driver({ status: 200, body: { id: "pi_1", status: "succeeded" } });
    const result = await payments.chargeSaved({
      idempotencyKey: "boost-day:1",
      amountMinor: 1250,
      currency: "AUD",
      customerRef: "cus_1",
      paymentMethodRef: "pm_1",
      reference: "boost-day:1",
      description: "Boost, 3 days",
    });
    expect(result._unsafeUnwrap()).toStrictEqual({ paymentReference: "pi_1", status: "succeeded" });
    expect(calls[0]?.url).toBe(`${TEST_BASE}/v1/payment_intents`);
    expect(calls[0]?.headers["Idempotency-Key"]).toBe("boost-day:1");
    expect(formLines(calls[0]?.body)).toStrictEqual([
      "amount=1250",
      "currency=aud",
      "customer=cus_1",
      "payment_method=pm_1",
      "confirm=true",
      "off_session=true",
      "capture_method=automatic",
      "description=Boost, 3 days",
      "metadata[reference]=boost-day:1",
    ]);
  });

  it.each([
    { answer: { status: 200, body: { id: "pi_1", status: "processing" } }, outcome: "pending" },
    {
      answer: { status: 200, body: { id: "pi_1", status: "requires_action" } },
      outcome: "declined",
    },
    {
      answer: {
        status: 402,
        body: {
          error: {
            type: "card_error",
            code: "card_declined",
            decline_code: "insufficient_funds",
            message: "Your card has insufficient funds.",
          },
        },
      },
      outcome: "declined",
    },
  ])("a saved charge answered $answer.body.status → $outcome", async ({ answer, outcome }) => {
    const { payments } = driver(answer);
    const result = await payments.chargeSaved({
      idempotencyKey: "boost:2",
      amountMinor: 500,
      currency: "AUD",
      customerRef: "cus_1",
      paymentMethodRef: "pm_1",
      reference: "boost:2",
    });
    if (outcome === "pending") expect(result._unsafeUnwrap().status).toBe("pending");
    else
      expect(result._unsafeUnwrapErr()).toMatchObject({
        kind: "declined",
        mayHaveSucceeded: false,
      });
  });

  it("refunds part of a payment, or what is left when no amount is given", async () => {
    const { payments, calls } = driver({ status: 200, body: { id: "re_1", status: "succeeded" } });
    const part = await payments.refund({
      idempotencyKey: "refund:1",
      paymentReference: "pi_1",
      currency: "AUD",
      amountMinor: 1000,
      reference: "refund:1",
    });
    expect(part._unsafeUnwrap()).toStrictEqual({ refundReference: "re_1", status: "succeeded" });
    const rest = await payments.refund({
      idempotencyKey: "refund:2",
      paymentReference: "pi_1",
      currency: "AUD",
      reference: "refund:2",
    });
    expect(rest.isOk()).toBe(true);
    expect(calls.map((call) => formLines(call.body))).toStrictEqual([
      ["payment_intent=pi_1", "amount=1000", "metadata[reference]=refund:1"],
      ["payment_intent=pi_1", "metadata[reference]=refund:2"],
    ]);
    expect(calls[1]?.headers["Idempotency-Key"]).toBe("refund:2");
  });

  it("refuses the legacy charge()", async () => {
    const { payments, calls } = driver();
    const result = await payments.charge({
      idempotencyKey: "k",
      amountMinor: 100,
      currency: "AUD",
      reference: "r",
    });
    expect(result._unsafeUnwrapErr().kind).toBe("declined");
    expect(payments.deliveries("x")).toStrictEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("the Stripe webhook", () => {
  const NOW_S = 1_800_000_000;
  const body = JSON.stringify({
    id: "evt_1",
    object: "event",
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: "pi_1",
        amount_received: 4500,
        currency: "aud",
        metadata: { reference: "boost:1" },
      },
    },
  });

  it("verifies Stripe-Signature (any header case) and normalises the event", () => {
    const { payments } = driver();
    const result = payments.parseWebhook(
      {
        rawBody: body,
        headers: { "Stripe-Signature": signStripePayload(body, WEBHOOK_SECRET, NOW_S) },
      },
      NOW_S * 1_000,
    );
    expect(result._unsafeUnwrap()).toStrictEqual({
      type: "payment.succeeded",
      eventId: "evt_1",
      paymentReference: "pi_1",
      reference: "boost:1",
      amountMinor: 4500,
      currency: "AUD",
    });
  });

  it("refuses an unsigned or wrongly signed delivery before reading it", () => {
    const { payments } = driver();
    expect(
      payments.parseWebhook({ rawBody: body, headers: {} }, NOW_S * 1_000)._unsafeUnwrapErr().kind,
    ).toBe("missing_signature");
    const forged = signStripePayload(body, "whsec_attacker", NOW_S);
    expect(
      payments
        .parseWebhook({ rawBody: body, headers: { "stripe-signature": forged } }, NOW_S * 1_000)
        ._unsafeUnwrapErr().kind,
    ).toBe("bad_signature");
  });

  it("refuses a signed body that is not an event", () => {
    const { payments } = driver();
    const notEvent = "{}";
    const header = signStripePayload(notEvent, WEBHOOK_SECRET, NOW_S);
    expect(
      payments
        .parseWebhook({ rawBody: notEvent, headers: { "stripe-signature": header } }, NOW_S * 1_000)
        ._unsafeUnwrapErr(),
    ).toMatchObject({ kind: "malformed_event" });
  });
});

describe("building from the environment", () => {
  it("needs the webhook secret as well as the key", () => {
    expect(() => createStripePaymentsFromEnv({ STRIPE_SECRET_KEY: TEST_KEY })).toThrow(
      /STRIPE_WEBHOOK_SECRET/,
    );
    expect(
      createStripePaymentsFromEnv({
        STRIPE_SECRET_KEY: TEST_KEY,
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      }).provider,
    ).toBe("stripe");
  });
});
