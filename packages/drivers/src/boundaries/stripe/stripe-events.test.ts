import { describe, expect, it } from "vitest";
import { normaliseStripeEvent } from "./stripe-events";

function event(
  type: string,
  object: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    id: "evt_1",
    object: "event",
    api_version: "2024-06-20",
    created: 1_800_000_000,
    type,
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: "k" },
    data: { object },
    ...extra,
  });
}

const PI = {
  id: "pi_1",
  object: "payment_intent",
  amount: 4500,
  amount_received: 4500,
  currency: "aud",
  metadata: { reference: "card-purchase:1" },
};

describe("every event type the contract emits", () => {
  it("checkout.session.completed (payment): our reference, the PaymentIntent and the amount in OUR units", () => {
    const body = event("checkout.session.completed", {
      id: "cs_test_1",
      object: "checkout.session",
      mode: "payment",
      status: "complete",
      payment_status: "paid",
      amount_total: 4500,
      currency: "aud",
      customer: "cus_1",
      client_reference_id: "card-purchase:1",
      metadata: { reference: "card-purchase:1" },
      payment_intent: "pi_1",
      setup_intent: null,
    });
    expect(normaliseStripeEvent(body)._unsafeUnwrap()).toStrictEqual({
      type: "checkout.completed",
      eventId: "evt_1",
      checkoutReference: "cs_test_1",
      mode: "payment",
      reference: "card-purchase:1",
      paymentReference: "pi_1",
      amountMinor: 4500,
      currency: "AUD",
      customerRef: "cus_1",
      paymentMethodRef: null,
    });
  });

  it.each(["unpaid", "no_payment_required", undefined])(
    "checkout.session.completed (payment) with payment_status %s is ignored until it is paid",
    (paymentStatus) => {
      const body = event("checkout.session.completed", {
        id: "cs_test_4",
        object: "checkout.session",
        mode: "payment",
        status: "complete",
        payment_status: paymentStatus,
        amount_total: 4500,
        currency: "aud",
        payment_intent: "pi_4",
      });
      expect(normaliseStripeEvent(body)._unsafeUnwrap()).toStrictEqual({
        type: "ignored",
        eventId: "evt_1",
        providerType: "checkout.session.completed",
      });
    },
  );

  it("checkout.session.completed (setup): no amount, the card is read with cardSetupResult", () => {
    const body = event("checkout.session.completed", {
      id: "cs_test_2",
      object: "checkout.session",
      mode: "setup",
      status: "complete",
      amount_total: null,
      currency: "aud",
      customer: "cus_1",
      client_reference_id: null,
      metadata: { reference: "card-setup:1" },
      payment_intent: null,
      setup_intent: "seti_1",
    });
    expect(normaliseStripeEvent(body)._unsafeUnwrap()).toStrictEqual({
      type: "checkout.completed",
      eventId: "evt_1",
      checkoutReference: "cs_test_2",
      mode: "setup",
      reference: "card-setup:1",
      paymentReference: null,
      amountMinor: null,
      currency: null,
      customerRef: "cus_1",
      paymentMethodRef: null,
    });
  });

  it("checkout.session.expired", () => {
    const body = event("checkout.session.expired", {
      id: "cs_test_3",
      object: "checkout.session",
      status: "expired",
      client_reference_id: "card-purchase:3",
    });
    expect(normaliseStripeEvent(body)._unsafeUnwrap()).toStrictEqual({
      type: "checkout.expired",
      eventId: "evt_1",
      checkoutReference: "cs_test_3",
      reference: "card-purchase:3",
    });
  });

  it("payment_intent.succeeded uses amount_received (a partial capture is what was taken)", () => {
    const body = event("payment_intent.succeeded", { ...PI, amount: 5000, status: "succeeded" });
    expect(normaliseStripeEvent(body)._unsafeUnwrap()).toStrictEqual({
      type: "payment.succeeded",
      eventId: "evt_1",
      paymentReference: "pi_1",
      reference: "card-purchase:1",
      amountMinor: 4500,
      currency: "AUD",
    });
  });

  it.each([
    { error: { code: "card_declined", decline_code: "generic_decline" }, code: "generic_decline" },
    {
      error: { code: "payment_intent_authentication_failure" },
      code: "payment_intent_authentication_failure",
    },
    { error: null, code: null },
  ])("payment_intent.payment_failed → code $code", ({ error, code }) => {
    const body = event("payment_intent.payment_failed", {
      ...PI,
      status: "requires_payment_method",
      last_payment_error: error,
    });
    expect(normaliseStripeEvent(body)._unsafeUnwrap()).toStrictEqual({
      type: "payment.failed",
      eventId: "evt_1",
      paymentReference: "pi_1",
      reference: "card-purchase:1",
      code,
    });
  });

  it("payment_intent.canceled carries the reason (the 7-day sweep says automatic)", () => {
    const body = event("payment_intent.canceled", {
      ...PI,
      status: "canceled",
      cancellation_reason: "automatic",
    });
    expect(normaliseStripeEvent(body)._unsafeUnwrap()).toStrictEqual({
      type: "payment.canceled",
      eventId: "evt_1",
      paymentReference: "pi_1",
      reference: "card-purchase:1",
      reason: "automatic",
    });
  });

  it("refund.created (succeeded) → refund.succeeded; a pending one is ignored until refund.updated", () => {
    const refund = {
      id: "re_1",
      object: "refund",
      amount: 1250,
      currency: "aud",
      payment_intent: "pi_1",
      charge: "ch_1",
    };
    expect(
      normaliseStripeEvent(
        event("refund.created", { ...refund, status: "succeeded" }),
      )._unsafeUnwrap(),
    ).toStrictEqual({
      type: "refund.succeeded",
      eventId: "evt_1",
      refundReference: "re_1",
      paymentReference: "pi_1",
      amountMinor: 1250,
      currency: "AUD",
    });
    expect(
      normaliseStripeEvent(
        event("refund.created", { ...refund, status: "pending" }),
      )._unsafeUnwrap(),
    ).toStrictEqual({
      type: "ignored",
      eventId: "evt_1",
      providerType: "refund.created",
    });
    expect(
      normaliseStripeEvent(
        event("refund.updated", { ...refund, status: "succeeded" }),
      )._unsafeUnwrap().type,
    ).toBe("refund.succeeded");
  });

  it("account.updated carries onboarding state and the bank account's last4", () => {
    const body = event(
      "account.updated",
      {
        id: "acct_1",
        object: "account",
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
        external_accounts: {
          object: "list",
          data: [{ id: "ba_1", object: "bank_account", last4: "3456" }],
        },
      },
      { account: "acct_1" },
    );
    expect(normaliseStripeEvent(body)._unsafeUnwrap()).toStrictEqual({
      type: "account.updated",
      eventId: "evt_1",
      accountRef: "acct_1",
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      bankLast4: "3456",
    });
  });

  it.each([
    { type: "payout.paid", status: "paid", failure_code: null },
    { type: "payout.failed", status: "failed", failure_code: "account_closed" },
  ])("$type names the connected account from event.account", ({ type, status, failure_code }) => {
    const payout = {
      id: "po_1",
      object: "payout",
      amount: 9900,
      currency: "aud",
      status,
      failure_code,
      metadata: { reference: "statement:7" },
    };
    expect(
      normaliseStripeEvent(event(type, payout, { account: "acct_9" }))._unsafeUnwrap(),
    ).toStrictEqual({
      type,
      eventId: "evt_1",
      accountRef: "acct_9",
      payoutRef: "po_1",
      reference: "statement:7",
      amountMinor: 9900,
      currency: "AUD",
      failureCode: failure_code,
    });
    // A daily-schedule sweep payout carries no metadata.
    const swept = normaliseStripeEvent(
      event(type, { ...payout, metadata: {} }, { account: "acct_9" }),
    );
    expect(swept._unsafeUnwrap()).toMatchObject({ reference: null });
    expect(normaliseStripeEvent(event(type, payout))._unsafeUnwrapErr().kind).toBe(
      "malformed_event",
    );
  });

  it.each([
    "payment_intent.amount_capturable_updated",
    "setup_intent.succeeded",
    "charge.refunded",
    "transfer.created",
    "customer.created",
  ])("%s is ignored", (type) => {
    expect(normaliseStripeEvent(event(type, { id: "x_1" }))._unsafeUnwrap()).toStrictEqual({
      type: "ignored",
      eventId: "evt_1",
      providerType: type,
    });
  });
});

describe("a body that is not an event", () => {
  it.each([
    ["not JSON", "{nope"],
    ["an array", "[]"],
    [
      "not an event object",
      JSON.stringify({ id: "evt_1", object: "charge", type: "x", data: { object: {} } }),
    ],
    ["no id", JSON.stringify({ object: "event", type: "payout.paid", data: { object: {} } })],
    [
      "no data.object",
      JSON.stringify({ id: "evt_1", object: "event", type: "payout.paid", data: {} }),
    ],
    ["an object without an id", event("payment_intent.succeeded", { ...PI, id: undefined })],
    [
      "a currency the driver does not speak",
      event("payment_intent.succeeded", { ...PI, currency: "idr" }),
    ],
    ["a non-integer amount", event("payment_intent.succeeded", { ...PI, amount_received: 45.5 })],
    [
      "an unknown checkout mode",
      event("checkout.session.completed", { id: "cs_1", mode: "subscription" }),
    ],
  ])("%s → malformed_event", (_name, body) => {
    expect(normaliseStripeEvent(body)._unsafeUnwrapErr().kind).toBe("malformed_event");
  });
});
