import { describe, expect, it } from "vitest";
import { createStripeMarketplacePayments } from "./stripe-marketplace";
import {
  type ScriptedAnswer,
  TEST_BASE,
  TEST_KEY,
  formLines,
  recordingFetch,
} from "./stripe-fetch-double";

function driver(...answers: ScriptedAnswer[]) {
  const double = recordingFetch(...answers);
  return {
    market: createStripeMarketplacePayments({
      apiBase: TEST_BASE,
      secretKey: TEST_KEY,
      fetch: double.fetch,
    }),
    calls: double.calls,
  };
}

const bid = {
  idempotencyKey: "auction-bid:b1",
  amountMinor: 12_500,
  currency: "AUD" as const,
  reference: "auction:a1",
  customerRef: "cus_1",
  paymentMethodRef: "pm_1",
  destinationReference: "acct_charity",
};

const held = {
  id: "pi_hold",
  status: "requires_capture",
  amount_capturable: 12_500,
  transfer_data: { destination: "acct_charity" },
};

describe("Stripe charity auction holds", () => {
  it("places a manual-capture hold on the saved card, destined for the charity", async () => {
    const { market, calls } = driver({ status: 200, body: held });
    const hold = await market.hold(bid);
    expect(hold._unsafeUnwrap()).toStrictEqual({
      holdReference: "pi_hold",
      providerAmount: 12_500,
    });
    expect(calls[0]?.url).toBe(`${TEST_BASE}/v1/payment_intents`);
    expect(calls[0]?.headers["Idempotency-Key"]).toBe("auction-bid:b1");
    expect(formLines(calls[0]?.body)).toStrictEqual([
      "amount=12500",
      "currency=aud",
      "customer=cus_1",
      "payment_method=pm_1",
      "confirm=true",
      "off_session=true",
      "capture_method=manual",
      "transfer_data[destination]=acct_charity",
      "on_behalf_of=acct_charity",
      "metadata[reference]=auction:a1",
    ]);
  });

  it("refuses a hold without a saved card or a destination, without calling Stripe", async () => {
    const { market, calls } = driver();
    const { customerRef: _c, ...noCard } = bid;
    expect((await market.hold(noCard))._unsafeUnwrapErr().kind).toBe("declined");
    const { destinationReference: _d, ...noDestination } = bid;
    expect((await market.hold(noDestination))._unsafeUnwrapErr().kind).toBe("declined");
    expect(
      (await market.hold({ ...bid, currency: "IDR", amountMinor: 25_000 }))._unsafeUnwrapErr().kind,
    ).toBe("declined");
    expect(calls).toHaveLength(0);
    expect(market.needsSavedCard).toBe(true);
  });

  it("treats a hold that did not reach requires_capture as declined", async () => {
    const { market } = driver({ status: 200, body: { ...held, status: "requires_action" } });
    expect((await market.hold(bid))._unsafeUnwrapErr()).toMatchObject({
      kind: "declined",
      mayHaveSucceeded: false,
    });
  });

  it("checks the destination, then captures amount_to_capture", async () => {
    const { market, calls } = driver(
      { status: 200, body: held },
      { status: 200, body: { ...held, status: "succeeded", amount_received: 12_000 } },
    );
    const capture = await market.capture({
      idempotencyKey: "auction-capture:a1:b1",
      holdReference: "pi_hold",
      amountMinor: 12_000,
      currency: "AUD",
      destinationReference: "acct_charity",
    });
    expect(capture._unsafeUnwrap()).toStrictEqual({
      captureReference: "pi_hold",
      destinationReference: "acct_charity",
      providerAmount: 12_000,
    });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toStrictEqual([
      `GET ${TEST_BASE}/v1/payment_intents/pi_hold`,
      `POST ${TEST_BASE}/v1/payment_intents/pi_hold/capture`,
    ]);
    expect(formLines(calls[1]?.body)).toStrictEqual(["amount_to_capture=12000"]);
    expect(calls[1]?.headers["Idempotency-Key"]).toBe("auction-capture:a1:b1");
  });

  it("never captures a hold destined for another account", async () => {
    const { market, calls } = driver({
      status: 200,
      body: { ...held, transfer_data: { destination: "acct_other" } },
    });
    const capture = await market.capture({
      idempotencyKey: "c",
      holdReference: "pi_hold",
      amountMinor: 12_500,
      currency: "AUD",
      destinationReference: "acct_charity",
    });
    expect(capture._unsafeUnwrapErr()).toMatchObject({ kind: "declined", mayHaveSucceeded: false });
    expect(calls).toHaveLength(1);
  });

  it("releases by canceling, with the caller's key or one derived from the bare hold reference", async () => {
    const { market, calls } = driver({ status: 200, body: { id: "pi_hold", status: "canceled" } });
    expect(
      (await market.release({ idempotencyKey: "release:b1", holdReference: "pi_hold" })).isOk(),
    ).toBe(true);
    expect((await market.release("pi_hold")).isOk()).toBe(true);
    expect(
      calls.map((call) => [call.url, call.headers["Idempotency-Key"], call.body]),
    ).toStrictEqual([
      [`${TEST_BASE}/v1/payment_intents/pi_hold/cancel`, "release:b1", ""],
      [`${TEST_BASE}/v1/payment_intents/pi_hold/cancel`, "release:pi_hold", ""],
    ]);
  });

  it("counts a hold Stripe already canceled (the 7-day sweep) as released", async () => {
    const { market } = driver(
      {
        status: 400,
        body: {
          error: {
            type: "invalid_request_error",
            code: "payment_intent_unexpected_state",
            message: "already canceled",
          },
        },
      },
      { status: 200, body: { id: "pi_hold", status: "canceled" } },
    );
    expect((await market.release("pi_hold")).isOk()).toBe(true);
  });

  it("reports a release Stripe refused for another reason", async () => {
    const { market } = driver(
      { status: 400, body: { error: { type: "invalid_request_error", message: "captured" } } },
      { status: 200, body: { id: "pi_hold", status: "succeeded" } },
    );
    expect((await market.release("pi_hold"))._unsafeUnwrapErr().kind).toBe("declined");
  });
});
