import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CARD_OK, type Kit, makeKit, onboardedAccount } from "./test-kit";

let k: Kit;
beforeAll(async () => {
  k = await makeKit();
});
afterAll(async () => {
  await k.sim.close();
});

/** A customer with a saved 4242 card, made the way the driver would: Checkout in setup mode. */
async function savedCard(): Promise<{ customer: string; pm: string }> {
  const c = await k.post("/v1/customers", { email: "saved@example.test" });
  const s = await k.post("/v1/checkout/sessions", {
    mode: "setup",
    currency: "aud",
    customer: c.json["id"],
    success_url: "https://app.test/ok",
  });
  await k.browser.submitCheckout(s.json["id"] as string, CARD_OK);
  const got = await k.get(`/v1/checkout/sessions/${s.json["id"]}`, { expand: ["setup_intent"] });
  return {
    customer: c.json["id"] as string,
    pm: got.json["setup_intent"].payment_method as string,
  };
}

async function balance(account?: string): Promise<number> {
  const res = await k.get(
    "/v1/balance",
    {},
    account === undefined ? {} : { "stripe-account": account },
  );
  return res.json["available"][0].amount as number;
}

describe("PaymentIntents", () => {
  it("confirms a saved card off-session and succeeds", async () => {
    const { customer, pm } = await savedCard();
    const res = await k.post("/v1/payment_intents", {
      amount: 2500,
      currency: "aud",
      customer,
      payment_method: pm,
      confirm: true,
      off_session: true,
      description: "Top up",
      metadata: { reference: "r1" },
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      object: "payment_intent",
      status: "succeeded",
      amount: 2500,
      amount_received: 2500,
      amount_capturable: 0,
      capture_method: "automatic",
      customer,
      payment_method: pm,
      description: "Top up",
      metadata: { reference: "r1" },
      transfer_data: null,
      canceled_at: null,
      last_payment_error: null,
    });
    expect(res.json["latest_charge"]).toMatch(/^ch_/);
    const expanded = await k.get(`/v1/payment_intents/${res.json["id"]}`, {
      expand: ["latest_charge"],
    });
    expect(expanded.json["latest_charge"]).toMatchObject({
      object: "charge",
      amount: 2500,
      captured: true,
    });
  });

  it("a saved 3-D Secure card never asks again after setup", async () => {
    const c = await k.post("/v1/customers", {});
    const s = await k.post("/v1/checkout/sessions", {
      mode: "setup",
      customer: c.json["id"],
      success_url: "https://app.test/ok",
    });
    await k.browser.submitCheckout(s.json["id"] as string, {
      number: "4000 0025 0000 3155",
      expiry: "12 / 34",
      cvc: "123",
    });
    await k.browser.decideThreeDS(s.json["id"] as string, "complete");
    const got = await k.get(`/v1/checkout/sessions/${s.json["id"]}`, { expand: ["setup_intent"] });
    const pi = await k.post("/v1/payment_intents", {
      amount: 1000,
      currency: "aud",
      customer: c.json["id"],
      payment_method: got.json["setup_intent"].payment_method,
      confirm: true,
      off_session: true,
    });
    expect(pi.json["status"]).toBe("succeeded");
  });

  it("validates amount, currency, customer, payment method and capture method", async () => {
    const { customer, pm } = await savedCard();
    const post = (p: object) => k.post("/v1/payment_intents", { currency: "aud", ...p });
    expect((await post({})).json["error"]).toMatchObject({
      code: "parameter_missing",
      param: "amount",
    });
    expect((await post({ amount: 49 })).json["error"].code).toBe("amount_too_small");
    expect((await post({ amount: "1.5" })).json["error"].code).toBe("parameter_invalid_integer");
    expect((await post({ amount: 1000, currency: "usd" })).status).toBe(400);
    expect((await post({ amount: 1000, customer: "cus_ghost" })).status).toBe(404);
    expect((await post({ amount: 1000, customer, payment_method: "pm_ghost" })).status).toBe(404);
    expect((await post({ amount: 1000, payment_method: pm })).status).toBe(400);
    expect(
      (await post({ amount: 1000, customer, payment_method: pm, capture_method: "weird" })).status,
    ).toBe(400);
    expect((await post({ amount: 1000, customer, confirm: true })).json["error"].param).toBe(
      "payment_method",
    );
    const other = await k.post("/v1/customers", {});
    expect(
      (await post({ amount: 1000, customer: other.json["id"], payment_method: pm })).status,
    ).toBe(400);
  });

  it("an unconfirmed intent waits, and can be canceled with a reason and an event", async () => {
    const { customer, pm } = await savedCard();
    const pi = await k.post("/v1/payment_intents", {
      amount: 1000,
      currency: "aud",
      customer,
      payment_method: pm,
    });
    expect(pi.json["status"]).toBe("requires_confirmation");
    const canceled = await k.post(`/v1/payment_intents/${pi.json["id"]}/cancel`, {
      cancellation_reason: "requested_by_customer",
    });
    expect(canceled.json).toMatchObject({
      status: "canceled",
      cancellation_reason: "requested_by_customer",
    });
    expect(canceled.json["canceled_at"]).toBeGreaterThan(0);
    const events = (await k.sim.store.listObjects("event")).map((e) => e.data["type"]);
    expect(events).toContain("payment_intent.canceled");
    expect((await k.post(`/v1/payment_intents/${pi.json["id"]}/cancel`)).json["error"].code).toBe(
      "payment_intent_unexpected_state",
    );
    expect(
      (await k.post(`/v1/payment_intents/${pi.json["id"]}/cancel`, { cancellation_reason: "bad" }))
        .status,
    ).toBe(400);
  });

  it("a succeeded intent cannot be canceled", async () => {
    const { customer, pm } = await savedCard();
    const pi = await k.post("/v1/payment_intents", {
      amount: 1000,
      currency: "aud",
      customer,
      payment_method: pm,
      confirm: true,
    });
    const res = await k.post(`/v1/payment_intents/${pi.json["id"]}/cancel`);
    expect(res.status).toBe(400);
    expect(res.json["error"].message).toContain("status of succeeded");
  });
});

describe("manual capture holds", () => {
  async function hold(amount = 5000): Promise<string> {
    const { customer, pm } = await savedCard();
    const pi = await k.post("/v1/payment_intents", {
      amount,
      currency: "aud",
      customer,
      payment_method: pm,
      confirm: true,
      capture_method: "manual",
    });
    expect(pi.json).toMatchObject({
      status: "requires_capture",
      amount_capturable: amount,
      amount_received: 0,
    });
    return pi.json["id"] as string;
  }

  it("captures part of the hold", async () => {
    const id = await hold();
    const before = await balance();
    const captured = await k.post(`/v1/payment_intents/${id}/capture`, { amount_to_capture: 3000 });
    expect(captured.json).toMatchObject({
      status: "succeeded",
      amount_received: 3000,
      amount_capturable: 0,
    });
    expect(await balance()).toBe(before + 3000);
    const types = (await k.sim.store.listObjects("event")).map((e) => e.data["type"]);
    expect(types).toContain("payment_intent.amount_capturable_updated");
  });

  it("captures the whole hold by default and refuses more than the hold", async () => {
    const id = await hold(2000);
    const over = await k.post(`/v1/payment_intents/${id}/capture`, { amount_to_capture: 2001 });
    expect(over.status).toBe(400);
    expect(over.json["error"].param).toBe("amount_to_capture");
    const done = await k.post(`/v1/payment_intents/${id}/capture`);
    expect(done.json["amount_received"]).toBe(2000);
    expect((await k.post(`/v1/payment_intents/${id}/capture`)).json["error"].code).toBe(
      "payment_intent_unexpected_state",
    );
  });

  it("cancels a hold", async () => {
    const id = await hold();
    const res = await k.post(`/v1/payment_intents/${id}/cancel`);
    expect(res.json["status"]).toBe("canceled");
  });

  it("the sweep releases a hold not captured within 7 days", async () => {
    const id = await hold();
    k.advance(6 * 24 * 3600 * 1000);
    await k.sim.tick();
    expect((await k.get(`/v1/payment_intents/${id}`)).json["status"]).toBe("requires_capture");
    k.advance(25 * 3600 * 1000);
    await k.sim.tick();
    const got = await k.get(`/v1/payment_intents/${id}`);
    expect(got.json).toMatchObject({ status: "canceled", cancellation_reason: "automatic" });
    const canceled = (await k.sim.store.listObjects("event")).filter(
      (e) =>
        e.data["type"] === "payment_intent.canceled" &&
        (e.data["data"] as { object: { id: string } }).object.id === id,
    );
    expect(canceled).toHaveLength(1);
  });
});

describe("destination charges", () => {
  it("lands the amount in the connected account and records a transfer", async () => {
    const dest = await onboardedAccount(k);
    const { customer, pm } = await savedCard();
    const platformBefore = await balance();
    const pi = await k.post("/v1/payment_intents", {
      amount: 6000,
      currency: "aud",
      customer,
      payment_method: pm,
      confirm: true,
      transfer_data: { destination: dest },
    });
    expect(pi.json["transfer_data"]).toEqual({ destination: dest });
    expect(await balance(dest)).toBe(6000);
    expect(await balance()).toBe(platformBefore);
    const transfers = (await k.sim.store.listObjects("transfer")).filter(
      (t) => t.data["source_transaction"] === pi.json["latest_charge"],
    );
    expect(transfers).toHaveLength(1);
    expect(transfers[0]?.data).toMatchObject({ destination: dest, amount: 6000 });
  });

  it("with a hold, the transfer happens at capture", async () => {
    const dest = await onboardedAccount(k, "000123456", {
      settings: { payouts: { schedule: { interval: "manual" } } },
    });
    const { customer, pm } = await savedCard();
    const pi = await k.post("/v1/payment_intents", {
      amount: 4000,
      currency: "aud",
      customer,
      payment_method: pm,
      confirm: true,
      capture_method: "manual",
      transfer_data: { destination: dest },
    });
    expect(await balance(dest)).toBe(0);
    await k.post(`/v1/payment_intents/${pi.json["id"]}/capture`, { amount_to_capture: 1500 });
    expect(await balance(dest)).toBe(1500);
  });

  it("refuses a destination that has not finished onboarding or does not exist", async () => {
    const { customer, pm } = await savedCard();
    const raw = await k.post("/v1/accounts", { type: "express", country: "AU" });
    const base = { amount: 1000, currency: "aud", customer, payment_method: pm, confirm: true };
    const res = await k.post("/v1/payment_intents", {
      ...base,
      transfer_data: { destination: raw.json["id"] },
    });
    expect(res.status).toBe(400);
    expect(res.json["error"].type).toBe("invalid_request_error");
    const ghost = await k.post("/v1/payment_intents", {
      ...base,
      transfer_data: { destination: "acct_ghost" },
    });
    expect(ghost.status).toBe(404);
  });
});

describe("refunds", () => {
  async function paid(amount = 4500): Promise<string> {
    const { customer, pm } = await savedCard();
    const pi = await k.post("/v1/payment_intents", {
      amount,
      currency: "aud",
      customer,
      payment_method: pm,
      confirm: true,
    });
    return pi.json["id"] as string;
  }

  it("refunds in full by default and emits both events", async () => {
    const pi = await paid();
    const before = await balance();
    const res = await k.post("/v1/refunds", {
      payment_intent: pi,
      reason: "requested_by_customer",
      metadata: { why: "x" },
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      object: "refund",
      amount: 4500,
      currency: "aud",
      payment_intent: pi,
      status: "succeeded",
      reason: "requested_by_customer",
      metadata: { why: "x" },
    });
    expect(res.json["id"]).toMatch(/^re_/);
    expect(res.json["charge"]).toMatch(/^ch_/);
    expect(await balance()).toBe(before - 4500);
    const types = (await k.sim.store.listObjects("event")).map((e) => e.data["type"]);
    expect(types).toEqual(expect.arrayContaining(["refund.created", "charge.refunded"]));
  });

  it("refunds in parts and refuses to over-refund", async () => {
    const pi = await paid(3000);
    expect((await k.post("/v1/refunds", { payment_intent: pi, amount: 1000 })).json["amount"]).toBe(
      1000,
    );
    const over = await k.post("/v1/refunds", { payment_intent: pi, amount: 2001 });
    expect(over.status).toBe(400);
    expect(over.json["error"].message).toContain("greater than unrefunded amount");
    const rest = await k.post("/v1/refunds", { payment_intent: pi });
    expect(rest.json["amount"]).toBe(2000);
    const done = await k.post("/v1/refunds", { payment_intent: pi });
    expect(done.json["error"].code).toBe("charge_already_refunded");
  });

  it("validates its inputs", async () => {
    expect((await k.post("/v1/refunds", {})).json["error"].code).toBe("parameter_missing");
    expect((await k.post("/v1/refunds", { payment_intent: "pi_ghost" })).status).toBe(404);
    const pi = await paid();
    expect((await k.post("/v1/refunds", { payment_intent: pi, amount: 0 })).status).toBe(400);
    expect((await k.post("/v1/refunds", { payment_intent: pi, reason: "nope" })).status).toBe(400);
    const { customer, pm } = await savedCard();
    const hold = await k.post("/v1/payment_intents", {
      amount: 1000,
      currency: "aud",
      customer,
      payment_method: pm,
      confirm: true,
      capture_method: "manual",
    });
    expect((await k.post("/v1/refunds", { payment_intent: hold.json["id"] })).status).toBe(400);
  });
});
