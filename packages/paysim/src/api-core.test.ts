import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Kit, makeKit, paymentSession } from "./test-kit";

let k: Kit;
beforeAll(async () => {
  k = await makeKit();
});
afterAll(async () => {
  await k.sim.close();
});

describe("transport and auth", () => {
  it("rejects a wrong key with Stripe's 401 and a masked key", async () => {
    const res = await fetch(`${k.sim.baseUrl}/v1/customers`, {
      method: "POST",
      headers: { authorization: "Bearer sk_test_wrong_key_1234" },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { type: string; message: string } };
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.message).toBe("Invalid API Key provided: sk_test_****1234");
  });

  it("rejects a missing key, and accepts Basic auth with the key as username", async () => {
    const none = await fetch(`${k.sim.baseUrl}/v1/balance`);
    expect(none.status).toBe(401);
    const basic = await fetch(`${k.sim.baseUrl}/v1/balance`, {
      headers: { authorization: `Basic ${Buffer.from(`${k.sim.secretKey}:`).toString("base64")}` },
    });
    expect(basic.status).toBe(200);
  });

  it("answers an unknown URL with Stripe's 404", async () => {
    const res = await k.get("/v1/nope");
    expect(res.status).toBe(404);
    expect(res.json["error"].message).toMatch(/^Unrecognized request URL \(GET: \/v1\/nope\)/);
  });

  it("refuses non-form bodies and malformed forms with a 400", async () => {
    const json = await fetch(`${k.sim.baseUrl}/v1/customers`, {
      method: "POST",
      headers: { authorization: `Bearer ${k.sim.secretKey}`, "content-type": "application/json" },
      body: '{"email":"a@b.c"}',
    });
    expect(json.status).toBe(400);
    const bad = await fetch(`${k.sim.baseUrl}/v1/customers`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${k.sim.secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "a[b=1",
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { type: string } }).error.type).toBe(
      "invalid_request_error",
    );
  });

  it("stamps request-id and echoes the Stripe-Version on events", async () => {
    const res = await k.post(
      "/v1/customers",
      { email: "v@example.test" },
      {
        "stripe-version": "2025-01-01",
      },
    );
    expect(res.headers.get("request-id")).toMatch(/^req_/);
    expect(res.headers.get("stripe-version")).toBe("2025-01-01");
    const s = await k.post("/v1/checkout/sessions", paymentSession(), {
      "stripe-version": "2025-01-01",
    });
    const exp = await k.post(
      `/v1/checkout/sessions/${s.json["id"]}/expire`,
      {},
      { "stripe-version": "2025-01-01" },
    );
    expect(exp.status).toBe(200);
    const events = await k.sim.store.listObjects("event");
    const expired = events.find((e) => e.data["type"] === "checkout.session.expired");
    expect(expired?.data["api_version"]).toBe("2025-01-01");
  });
});

describe("customers", () => {
  it("creates, retrieves and updates metadata", async () => {
    const created = await k.post("/v1/customers", {
      email: "a@example.test",
      name: "Ann",
      metadata: { reference: "u1", keep: "yes" },
    });
    expect(created.status).toBe(200);
    expect(created.json).toMatchObject({
      object: "customer",
      email: "a@example.test",
      name: "Ann",
      livemode: false,
      metadata: { reference: "u1", keep: "yes" },
      invoice_settings: { default_payment_method: null },
    });
    expect(created.json["id"]).toMatch(/^cus_[0-9A-Za-z]{24}$/);
    const got = await k.get(`/v1/customers/${created.json["id"]}`);
    expect(got.json["email"]).toBe("a@example.test");
    const updated = await k.post(`/v1/customers/${created.json["id"]}`, {
      metadata: { reference: "", other: "z" },
    });
    expect(updated.json["metadata"]).toEqual({ keep: "yes", other: "z" });
  });

  it("returns resource_missing for an unknown customer", async () => {
    const res = await k.get("/v1/customers/cus_nope");
    expect(res.status).toBe(404);
    expect(res.json["error"]).toMatchObject({
      type: "invalid_request_error",
      code: "resource_missing",
    });
  });

  it("refuses a default payment method that is not attached to the customer", async () => {
    const c = await k.post("/v1/customers", {});
    const res = await k.post(`/v1/customers/${c.json["id"]}`, {
      invoice_settings: { default_payment_method: "pm_nope" },
    });
    expect(res.status).toBe(404);
    expect(res.json["error"].param).toBe("invoice_settings[default_payment_method]");
  });
});

describe("checkout sessions", () => {
  it("creates a payment-mode session with the contract's fields", async () => {
    const res = await k.post(
      "/v1/checkout/sessions",
      paymentSession({
        client_reference_id: "order-1",
        locale: "id",
        metadata: { reference: "r1" },
        payment_intent_data: { description: "Voucher", metadata: { v: "1" } },
      }),
    );
    expect(res.status).toBe(200);
    const s = res.json;
    expect(s["id"]).toMatch(/^cs_test_[0-9A-Za-z]{24}$/);
    expect(s).toMatchObject({
      object: "checkout.session",
      mode: "payment",
      status: "open",
      payment_status: "unpaid",
      amount_total: 4500,
      amount_subtotal: 4500,
      currency: "aud",
      customer: null,
      client_reference_id: "order-1",
      metadata: { reference: "r1" },
      payment_intent: null,
      setup_intent: null,
      success_url: "https://app.test/ok?s={CHECKOUT_SESSION_ID}",
      cancel_url: "https://app.test/cancel",
      locale: "id",
    });
    expect(s["url"]).toBe(`${k.sim.baseUrl}/checkout/${s["id"]}`);
    expect(s["expires_at"]).toBe(Math.floor(k.now().getTime() / 1000) + 24 * 3600);
  });

  it("requires mode, success_url and a valid one, and rejects odd line items", async () => {
    expect((await k.post("/v1/checkout/sessions", {})).json["error"].code).toBe(
      "parameter_missing",
    );
    expect(
      (
        await k.post("/v1/checkout/sessions", {
          mode: "subscription",
          success_url: "https://a.test",
        })
      ).json["error"].param,
    ).toBe("mode");
    const noSuccess = await k.post("/v1/checkout/sessions", { mode: "payment" });
    expect(noSuccess.json["error"].param).toBe("success_url");
    const js = await k.post(
      "/v1/checkout/sessions",
      paymentSession({ success_url: "javascript:alert(1)" }),
    );
    expect(js.status).toBe(400);
    for (const bad of [
      "https://a.test/x y",
      "https://a.test/x\r\nSet-Cookie: a=b",
      "ftp://a.test",
    ]) {
      const res = await k.post("/v1/checkout/sessions", paymentSession({ cancel_url: bad }));
      expect(res.json["error"].param).toBe("cancel_url");
    }
    const two = paymentSession();
    two["line_items"] = [
      { price_data: { currency: "aud", unit_amount: 100, product_data: { name: "a" } } },
      { price_data: { currency: "aud", unit_amount: 100, product_data: { name: "b" } } },
    ];
    expect((await k.post("/v1/checkout/sessions", two)).json["error"].param).toBe("line_items");
    const usd = paymentSession();
    usd["line_items"] = [
      { price_data: { currency: "usd", unit_amount: 1000, product_data: { name: "a" } } },
    ];
    expect((await k.post("/v1/checkout/sessions", usd)).status).toBe(400);
  });

  it("enforces the 50 cent minimum and integer amounts", async () => {
    const small = paymentSession();
    small["line_items"] = [
      { price_data: { currency: "aud", unit_amount: 49, product_data: { name: "a" } } },
    ];
    const res = await k.post("/v1/checkout/sessions", small);
    expect(res.status).toBe(400);
    expect(res.json["error"].code).toBe("amount_too_small");
    const bad = paymentSession();
    bad["line_items"] = [
      { price_data: { currency: "aud", unit_amount: "4x", product_data: { name: "a" } } },
    ];
    const res2 = await k.post("/v1/checkout/sessions", bad);
    expect(res2.json["error"].code).toBe("parameter_invalid_integer");
  });

  it("setup mode needs an existing customer", async () => {
    const base = { mode: "setup", success_url: "https://app.test/ok", currency: "aud" };
    const none = await k.post("/v1/checkout/sessions", base);
    expect(none.json["error"]).toMatchObject({ code: "parameter_missing", param: "customer" });
    const ghost = await k.post("/v1/checkout/sessions", { ...base, customer: "cus_ghost" });
    expect(ghost.status).toBe(404);
    const c = await k.post("/v1/customers", {});
    const ok = await k.post("/v1/checkout/sessions", {
      ...base,
      customer: c.json["id"],
      setup_intent_data: { metadata: { m: "1" } },
    });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({
      mode: "setup",
      payment_status: "no_payment_required",
      amount_total: null,
      customer: c.json["id"],
    });
  });

  it("bounds expires_at like Stripe (30 minutes to 24 hours)", async () => {
    const nowS = Math.floor(k.now().getTime() / 1000);
    expect(
      (await k.post("/v1/checkout/sessions", paymentSession({ expires_at: nowS + 60 }))).status,
    ).toBe(400);
    const ok = await k.post("/v1/checkout/sessions", paymentSession({ expires_at: nowS + 3600 }));
    expect(ok.json["expires_at"]).toBe(nowS + 3600);
  });

  it("expires an open session by API, and only once", async () => {
    const s = await k.post("/v1/checkout/sessions", paymentSession());
    const exp = await k.post(`/v1/checkout/sessions/${s.json["id"]}/expire`);
    expect(exp.json).toMatchObject({ status: "expired", url: null });
    const again = await k.post(`/v1/checkout/sessions/${s.json["id"]}/expire`);
    expect(again.status).toBe(400);
  });

  it("rejects expanding what cannot be expanded", async () => {
    const s = await k.post("/v1/checkout/sessions", paymentSession());
    const res = await k.get(`/v1/checkout/sessions/${s.json["id"]}`, { expand: ["bogus"] });
    expect(res.status).toBe(400);
    expect(res.json["error"].param).toBe("expand");
  });
});

describe("idempotency", () => {
  it("replays the stored response byte for byte, flagged as replayed", async () => {
    const params = { email: "idem@example.test" };
    const first = await k.post("/v1/customers", params, { "idempotency-key": "k-1" });
    const second = await k.post("/v1/customers", params, { "idempotency-key": "k-1" });
    expect(second.text).toBe(first.text);
    expect(first.headers.get("idempotent-replayed")).toBeNull();
    expect(second.headers.get("idempotent-replayed")).toBe("true");
    const customers = await k.sim.store.listObjects("customer");
    expect(customers.filter((c) => c.data["email"] === "idem@example.test")).toHaveLength(1);
  });

  it("refuses the same key with different params", async () => {
    await k.post("/v1/customers", { email: "x@example.test" }, { "idempotency-key": "k-2" });
    const res = await k.post(
      "/v1/customers",
      { email: "y@example.test" },
      { "idempotency-key": "k-2" },
    );
    expect(res.status).toBe(400);
    expect(res.json["error"].type).toBe("idempotency_error");
    expect(res.json["error"].message).toMatch(
      /^Keys for idempotent requests can only be used with the same parameters/,
    );
  });

  it("treats a key as new after 24 hours", async () => {
    const a = await k.post(
      "/v1/customers",
      { email: "old@example.test" },
      { "idempotency-key": "k-3" },
    );
    k.advance(25 * 3600 * 1000);
    const b = await k.post(
      "/v1/customers",
      { email: "new@example.test" },
      { "idempotency-key": "k-3" },
    );
    expect(b.status).toBe(200);
    expect(b.json["id"]).not.toBe(a.json["id"]);
  });

  it("scopes keys per Stripe-Account", async () => {
    const acct = await k.post("/v1/accounts", { type: "express", country: "AU" });
    const platform = await k.post(
      "/v1/customers",
      { email: "s@example.test" },
      { "idempotency-key": "k-4" },
    );
    const scoped = await k.post(
      "/v1/customers",
      { email: "different@example.test" },
      {
        "idempotency-key": "k-4",
        "stripe-account": acct.json["id"],
      },
    );
    expect(scoped.status).toBe(200);
    expect(scoped.json["id"]).not.toBe(platform.json["id"]);
  });

  it("does not store failures: the same key may be retried with fixed params", async () => {
    const bad = await k.post("/v1/transfers", { amount: 100 }, { "idempotency-key": "k-5" });
    expect(bad.status).toBe(400);
    const retry = await k.post(
      "/v1/customers",
      { email: "r@example.test" },
      { "idempotency-key": "k-5" },
    );
    expect(retry.status).toBe(200);
  });
});

describe("Stripe-Account scoping", () => {
  it("hides objects of one account from another scope", async () => {
    const acct = await k.post("/v1/accounts", { type: "express", country: "AU" });
    const id = acct.json["id"] as string;
    const mine = await k.post(
      "/v1/customers",
      { email: "scoped@example.test" },
      { "stripe-account": id },
    );
    const cid = mine.json["id"] as string;
    expect((await k.get(`/v1/customers/${cid}`)).status).toBe(404);
    expect((await k.get(`/v1/customers/${cid}`, {}, { "stripe-account": id })).status).toBe(200);
  });

  it("rejects a Stripe-Account that does not exist", async () => {
    const res = await k.get("/v1/balance", {}, { "stripe-account": "acct_ghost" });
    expect(res.status).toBe(403);
    expect(res.json["error"].code).toBe("account_invalid");
  });
});
