import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CARD_3DS, CARD_DECLINED, CARD_OK, type Kit, makeKit, paymentSession } from "./test-kit";

let k: Kit;
beforeAll(async () => {
  k = await makeKit();
});
afterAll(async () => {
  await k.sim.close();
});

const eventTypes = async (): Promise<string[]> =>
  (await k.sim.store.listObjects("event")).map((e) => e.data["type"] as string);

async function session(extra = {}): Promise<string> {
  const s = await k.post("/v1/checkout/sessions", paymentSession(extra));
  return s.json["id"] as string;
}

describe("the checkout page, payment mode", () => {
  it("renders the form with the simulated banner and the security headers", async () => {
    const id = await session({ metadata: { who: "<script>" } });
    const page = await k.browser.get(`/checkout/${id}`);
    expect(page.status).toBe(200);
    expect(page.html).toContain("Simulated payment, no real money");
    expect(page.html).toContain("Voucher");
    expect(page.html).toContain("$45.00 AUD");
    expect(page.html).not.toContain("<script");
    const res = await fetch(`${k.sim.config.publicBaseUrl}/checkout/${id}`);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self' https://app.test");
    expect(csp).not.toMatch(/script-src|unsafe-eval/);
    expect(csp).toContain("default-src 'none'");
  });

  it("pays with 4242: succeeded intent, complete session, 303 to success_url with the id", async () => {
    const id = await session({ payment_intent_data: { description: "d", metadata: { v: "1" } } });
    const res = await k.browser.submitCheckout(id, CARD_OK);
    expect(res.status).toBe(303);
    expect(res.location).toBe(`https://app.test/ok?s=${id}`);
    const got = await k.get(`/v1/checkout/sessions/${id}`, { expand: ["payment_intent"] });
    expect(got.json).toMatchObject({ status: "complete", payment_status: "paid", url: null });
    const pi = got.json["payment_intent"];
    expect(pi).toMatchObject({
      status: "succeeded",
      amount: 4500,
      amount_received: 4500,
      description: "d",
      metadata: { v: "1" },
    });
    expect(pi.latest_charge).toMatch(/^ch_/);
    const pm = await k.get(`/v1/payment_methods/${pi.payment_method}`);
    expect(pm.json["card"]).toEqual({
      brand: "visa",
      last4: "4242",
      exp_month: 12,
      exp_year: 2034,
      country: "AU",
      funding: "credit",
    });
    expect(await eventTypes()).toEqual(
      expect.arrayContaining(["payment_intent.succeeded", "checkout.session.completed"]),
    );
  });

  it("declines 4000...0002: stays open, says so, emits payment_failed", async () => {
    const id = await session();
    const res = await k.browser.submitCheckout(id, CARD_DECLINED);
    expect(res.status).toBe(200);
    expect(res.html).toContain("Your card was declined.");
    const got = await k.get(`/v1/checkout/sessions/${id}`, { expand: ["payment_intent"] });
    expect(got.json["status"]).toBe("open");
    expect(got.json["payment_intent"]).toMatchObject({
      status: "requires_payment_method",
      last_payment_error: { code: "card_declined", decline_code: "generic_decline" },
    });
    const failed = (await k.sim.store.listObjects("event")).filter(
      (e) => e.data["type"] === "payment_intent.payment_failed",
    );
    expect(failed.length).toBeGreaterThanOrEqual(1);
    // The shopper may try again with a good card; the same intent is reused.
    const retry = await k.browser.submitCheckout(id, CARD_OK);
    expect(retry.status).toBe(303);
    const done = await k.get(`/v1/checkout/sessions/${id}`);
    expect(done.json["payment_intent"]).toBe(got.json["payment_intent"].id);
  });

  it("3-D Secure: completing pays, failing returns to the form with the message", async () => {
    const ok = await session();
    const first = await k.browser.submitCheckout(ok, CARD_3DS);
    expect(first.status).toBe(303);
    expect(first.location).toBe(`/checkout/${ok}/3ds`);
    const challenge = await k.browser.get(`/checkout/${ok}/3ds`);
    expect(challenge.html).toContain("Complete authentication");
    expect(challenge.html).toContain("Fail authentication");
    const mid = await k.get(`/v1/checkout/sessions/${ok}`, { expand: ["payment_intent"] });
    expect(mid.json["payment_intent"].status).toBe("requires_action");
    const done = await k.browser.decideThreeDS(ok, "complete");
    expect(done.status).toBe(303);
    expect(done.location).toBe(`https://app.test/ok?s=${ok}`);
    expect((await k.get(`/v1/checkout/sessions/${ok}`)).json["payment_status"]).toBe("paid");

    const bad = await session();
    await k.browser.submitCheckout(bad, CARD_3DS);
    const failed = await k.browser.decideThreeDS(bad, "fail");
    expect(failed.status).toBe(200);
    expect(failed.html).toContain(
      "We are unable to authenticate your payment method. Please choose a different payment method and try again.",
    );
    const after = await k.get(`/v1/checkout/sessions/${bad}`, { expand: ["payment_intent"] });
    expect(after.json["status"]).toBe("open");
    expect(after.json["payment_intent"].last_payment_error.code).toBe(
      "payment_intent_authentication_failure",
    );
  });

  it("refuses a number that is not a Stripe test card and creates nothing", async () => {
    const id = await session();
    const before = (await k.sim.store.listObjects()).length;
    const res = await k.browser.submitCheckout(id, { ...CARD_OK, number: "5555 5555 5555 4444" });
    expect(res.status).toBe(200);
    expect(res.html).toContain("Use one of Stripe&#39;s test cards.");
    expect((await k.sim.store.listObjects()).length).toBe(before);
    expect(res.html).not.toContain("5555");
  });

  it("validates expiry (future, MM / YY) and a three digit CVC", async () => {
    const id = await session();
    const past = await k.browser.submitCheckout(id, { ...CARD_OK, expiry: "09 / 26" });
    expect(past.html).toContain("expiration date is in the past");
    const junk = await k.browser.submitCheckout(id, { ...CARD_OK, expiry: "13 / 30" });
    expect(junk.html).toContain("expiration date is invalid");
    const cvc = await k.browser.submitCheckout(id, { ...CARD_OK, cvc: "12" });
    expect(cvc.html).toContain("security code is invalid");
    const thisMonth = await k.browser.submitCheckout(id, { ...CARD_OK, expiry: "10/26" });
    expect(thisMonth.status).toBe(303);
  });

  it("rejects a post without a valid CSRF token", async () => {
    const id = await session();
    const res = await fetch(`${k.sim.config.publicBaseUrl}/checkout/${id}`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrf: "nope", ...CARD_OK }).toString(),
    });
    expect(res.status).toBe(403);
    expect((await k.get(`/v1/checkout/sessions/${id}`)).json["status"]).toBe("open");
  });

  it("a CSRF token for one session does not work on another", async () => {
    const a = await session();
    const b = await session();
    const page = await k.browser.get(`/checkout/${a}`);
    const token = /name="csrf" value="([^"]+)"/.exec(page.html)?.[1] ?? "";
    const res = await fetch(`${k.sim.config.publicBaseUrl}/checkout/${b}`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrf: token, ...CARD_OK }).toString(),
    });
    expect(res.status).toBe(403);
  });

  it("the cancel link redirects to cancel_url only", async () => {
    const id = await session();
    const res = await k.browser.get(`/checkout/${id}/cancel`);
    expect(res.status).toBe(303);
    expect(res.location).toBe("https://app.test/cancel");
    expect((await k.get(`/v1/checkout/sessions/${id}`)).json["status"]).toBe("open");
  });

  it("an expired session shows the expiry page, and the sweep expires it with an event", async () => {
    const id = await session();
    const csrf = await k.browser.csrfFrom(`/checkout/${id}`);
    k.advance(25 * 3600 * 1000);
    const tick = await k.sim.tick();
    expect(tick.swept).toBeGreaterThanOrEqual(1);
    expect((await k.get(`/v1/checkout/sessions/${id}`)).json["status"]).toBe("expired");
    expect(await eventTypes()).toContain("checkout.session.expired");
    const page = await k.browser.get(`/checkout/${id}`);
    expect(page.status).toBe(410);
    expect(page.html).toContain("expired");
    const post = await k.browser.submitCheckout(id, CARD_OK, csrf);
    expect(post.status).toBe(410);
  });

  it("expires lazily when the page is opened before the sweep runs", async () => {
    const id = await session();
    k.advance(25 * 3600 * 1000);
    const page = await k.browser.get(`/checkout/${id}`);
    expect(page.status).toBe(410);
    expect((await k.get(`/v1/checkout/sessions/${id}`)).json["status"]).toBe("expired");
  });

  it("a paid session cannot be paid twice", async () => {
    const id = await session();
    const csrf = await k.browser.csrfFrom(`/checkout/${id}`);
    await k.browser.submitCheckout(id, CARD_OK, csrf);
    const again = await k.browser.get(`/checkout/${id}`);
    expect(again.status).toBe(200);
    expect(again.html).toContain("already complete");
    const piId = (await k.get(`/v1/checkout/sessions/${id}`)).json["payment_intent"] as string;
    const post = await k.browser.submitCheckout(id, CARD_OK, csrf);
    expect(post.status).toBe(200);
    const charges = (await k.sim.store.listObjects("charge")).filter(
      (c) => c.data["payment_intent"] === piId,
    );
    expect(charges).toHaveLength(1);
  });

  it("serves Indonesian when the session locale is id, and follows Accept-Language on auto", async () => {
    const id = await session({ locale: "id" });
    const page = await k.browser.get(`/checkout/${id}`);
    expect(page.html).toContain("Pembayaran simulasi, tanpa uang sungguhan");
    expect(page.html).toContain('lang="id"');
    const auto = await session({ locale: "auto" });
    const res = await fetch(`${k.sim.config.publicBaseUrl}/checkout/${auto}`, {
      headers: { "accept-language": "id-ID,id;q=0.9" },
    });
    expect(await res.text()).toContain("Pembayaran simulasi");
    const en = await session();
    expect((await k.browser.get(`/checkout/${en}`)).html).toContain("Simulated payment");
  });

  it("answers an unknown session with a 404 page", async () => {
    const res = await k.browser.get("/checkout/cs_test_ghost");
    expect(res.status).toBe(404);
  });
});

describe("the checkout page, setup mode", () => {
  async function setupSession(): Promise<{ id: string; customer: string }> {
    const c = await k.post("/v1/customers", { email: "setup@example.test" });
    const s = await k.post("/v1/checkout/sessions", {
      mode: "setup",
      currency: "aud",
      customer: c.json["id"],
      success_url: "https://app.test/saved?s={CHECKOUT_SESSION_ID}",
      setup_intent_data: { metadata: { reference: "x" } },
    });
    return { id: s.json["id"] as string, customer: c.json["id"] as string };
  }

  it("saves 4242 to the customer as a payment method", async () => {
    const { id, customer } = await setupSession();
    const page = await k.browser.get(`/checkout/${id}`);
    expect(page.html).toContain("Save card");
    const res = await k.browser.submitCheckout(id, CARD_OK);
    expect(res.status).toBe(303);
    expect(res.location).toBe(`https://app.test/saved?s=${id}`);
    const got = await k.get(`/v1/checkout/sessions/${id}`, { expand: ["setup_intent"] });
    expect(got.json).toMatchObject({ status: "complete", payment_status: "no_payment_required" });
    const seti = got.json["setup_intent"];
    expect(seti).toMatchObject({
      status: "succeeded",
      customer,
      usage: "off_session",
      metadata: { reference: "x" },
    });
    const pm = await k.get(`/v1/payment_methods/${seti.payment_method}`);
    expect(pm.json).toMatchObject({ type: "card", customer });
    const fetched = await k.get(`/v1/setup_intents/${seti.id}`);
    expect(fetched.json["status"]).toBe("succeeded");
    expect(await eventTypes()).toEqual(
      expect.arrayContaining(["setup_intent.succeeded", "checkout.session.completed"]),
    );
  });

  it("declines and 3-D Secure behave as in payment mode, without payment events", async () => {
    const declined = await setupSession();
    const res = await k.browser.submitCheckout(declined.id, CARD_DECLINED);
    expect(res.html).toContain("Your card was declined.");
    expect((await k.get(`/v1/checkout/sessions/${declined.id}`)).json["status"]).toBe("open");

    const threeDs = await setupSession();
    await k.browser.submitCheckout(threeDs.id, CARD_3DS);
    expect((await k.browser.decideThreeDS(threeDs.id, "complete")).status).toBe(303);
    const got = await k.get(`/v1/checkout/sessions/${threeDs.id}`);
    expect(got.json["status"]).toBe("complete");
  });
});
