import { Writable } from "node:stream";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { createBrowser } from "./browser";
import { assertPaySimAllowed } from "./gate";
import { createMemoryPaySimStore } from "./memory-store";
import { registerPaySim } from "./plugin";
import { startPaySimServer } from "./server";
import { CARD_3DS, CARD_DECLINED, CARD_OK, type Params, encode, paymentSession } from "./test-kit";
import type { AddressInfo } from "node:net";
import type { PaySimConfig } from "./config";

const NUMBERS = ["4242424242424242", "4000000000000002", "4000002500003155", "5555555555554444"];
const spaced = (n: string): string => n.replace(/(\d{4})(?=\d)/g, "$1 ");

describe("the production gate", () => {
  it("throws on production, in any case, and allows dev and staging", () => {
    expect(() => assertPaySimAllowed("production")).toThrow(/production/);
    expect(() => assertPaySimAllowed(" Production ")).toThrow();
    expect(() => assertPaySimAllowed("dev")).not.toThrow();
    expect(() => assertPaySimAllowed("staging")).not.toThrow();
  });

  it("registerPaySim and the standalone server refuse production too", async () => {
    const app = Fastify();
    const config: PaySimConfig = {
      appEnv: "production",
      secretKey: "sk",
      webhookSecret: "wh",
      webhookUrl: "http://x.test",
      publicBaseUrl: "http://x.test",
      accountName: "A",
    };
    await expect(
      registerPaySim(app, { prefix: "/api/paysim", store: createMemoryPaySimStore(), config }),
    ).rejects.toThrow(/production/);
    await expect(startPaySimServer({ appEnv: "production" })).rejects.toThrow(/production/);
    await app.close();
  });
});

describe("no full card number is ever kept", () => {
  it("does not appear in any row, event, delivery, log line or page across every card flow", async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const app = Fastify({ logger: { level: "trace", stream: sink } });
    const store = createMemoryPaySimStore();
    const config: PaySimConfig = {
      appEnv: "dev",
      secretKey: "sk_test_logcheck",
      webhookSecret: "whsec_x",
      webhookUrl: "http://receiver.test/h",
      publicBaseUrl: "",
      accountName: "YourTal",
    };
    await registerPaySim(app, { prefix: "/api/paysim", store, config });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const origin = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    config.publicBaseUrl = `${origin}/api/paysim`;
    const browser = createBrowser(config.publicBaseUrl);
    const pages: string[] = [];

    const api = async (path: string, params: Params): Promise<{ id: string }> => {
      const res = await fetch(`${origin}/api/paysim${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.secretKey}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: encode(params).join("&"),
      });
      return (await res.json()) as { id: string };
    };
    const open = async (): Promise<string> =>
      (await api("/v1/checkout/sessions", paymentSession())).id;

    const cards = [
      CARD_OK,
      CARD_DECLINED,
      { ...CARD_OK, number: "5555-5555-5555-4444" },
      { ...CARD_OK, expiry: "01 / 20" },
    ];
    for (const card of cards) {
      const r = await browser.submitCheckout(await open(), card);
      pages.push(r.html);
    }
    const threeds = await open();
    await browser.submitCheckout(threeds, CARD_3DS);
    pages.push((await browser.decideThreeDS(threeds, "complete")).html);
    const customer = await api("/v1/customers", { email: "a@b.test" });
    const setup = await api("/v1/checkout/sessions", {
      mode: "setup",
      customer: customer.id,
      success_url: "https://app.test/ok",
    });
    pages.push((await browser.submitCheckout(setup.id, CARD_OK)).html);
    // A refused number is also posted outside the form flow, to the API's error path.
    await fetch(`${origin}/api/paysim/v1/customers`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "number=4242424242424242&bad[=1",
    });
    await app.close();

    const haystack = [
      JSON.stringify(await store.listObjects()),
      JSON.stringify(await store.listDeliveries()),
      lines.join("\n"),
      pages.join("\n"),
    ].join("\n");
    expect(lines.length).toBeGreaterThan(10);
    for (const n of NUMBERS) {
      expect(haystack).not.toContain(n);
      expect(haystack).not.toContain(spaced(n));
      expect(haystack).not.toContain(n.replace(/(\d{4})(?=\d)/g, "$1-"));
    }
    // What is kept: brand, last4 and expiry.
    expect(haystack).toContain('"last4":"4242"');
  });
});

describe("pages", () => {
  it("escape everything dynamic", async () => {
    const sim = await startPaySimServer();
    const evil = `<img src=x onerror=alert(1)>"'&`;
    const res = await fetch(`${sim.baseUrl}/v1/checkout/sessions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${sim.secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: encode(
        paymentSession({
          line_items: [
            {
              quantity: 1,
              price_data: { currency: "aud", unit_amount: 1000, product_data: { name: evil } },
            },
          ],
        }),
      ).join("&"),
    });
    const id = ((await res.json()) as { id: string }).id;
    const page = await createBrowser(sim.config.publicBaseUrl).get(`/checkout/${id}`);
    expect(page.html).not.toContain("<img");
    expect(page.html).toContain("&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;");
    await sim.close();
  });

  it("redirect only to the URLs the API caller set", async () => {
    const sim = await startPaySimServer();
    const mk = async (extra: Params): Promise<string> => {
      const r = await fetch(`${sim.baseUrl}/v1/checkout/sessions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${sim.secretKey}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: encode(paymentSession(extra)).join("&"),
      });
      return ((await r.json()) as { id: string }).id;
    };
    const id = await mk({ success_url: "https://shop.test/thanks?sid={CHECKOUT_SESSION_ID}&x=1" });
    const browser = createBrowser(sim.config.publicBaseUrl);
    const done = await browser.submitCheckout(id, CARD_OK);
    expect(done.location).toBe(`https://shop.test/thanks?sid=${id}&x=1`);
    // The form's redirect origins are in its CSP, so Chrome lets the 303 through.
    const open = await mk({
      success_url: "https://shop.test/a",
      cancel_url: "https://other.test/b",
    });
    const csp = (await fetch(`${sim.config.publicBaseUrl}/checkout/${open}`)).headers.get(
      "content-security-policy",
    );
    expect(csp).toContain("form-action 'self' https://shop.test https://other.test");
    await sim.close();
  });

  it("when mounted under a prefix, leave the host app's own routes and parsers alone", async () => {
    const app = Fastify();
    app.post("/host/json", (req) => ({ got: req.body }));
    const config: PaySimConfig = {
      appEnv: "dev",
      secretKey: "sk_test_mount",
      webhookSecret: "whsec_m",
      webhookUrl: "http://x.test/h",
      publicBaseUrl: "",
      accountName: "YourTal",
    };
    await registerPaySim(app, { prefix: "/api/paysim", store: createMemoryPaySimStore(), config });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const origin = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    config.publicBaseUrl = `${origin}/api/paysim`;

    const host = await fetch(`${origin}/host/json`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"a":1}',
    });
    expect(await host.json()).toEqual({ got: { a: 1 } });
    const sim = await fetch(`${origin}/api/paysim/v1/balance`, {
      headers: { authorization: "Bearer sk_test_mount" },
    });
    expect(sim.status).toBe(200);
    const miss = await fetch(`${origin}/api/paysim/v1/ghost`, {
      headers: { authorization: "Bearer sk_test_mount" },
    });
    expect(miss.status).toBe(404);
    expect(((await miss.json()) as { error: { type: string } }).error.type).toBe(
      "invalid_request_error",
    );
    const html404 = await fetch(`${origin}/api/paysim/nope`);
    expect(html404.status).toBe(404);
    expect(html404.headers.get("content-type")).toContain("text/html");
    // The page's form posts back under the prefix.
    const created = await fetch(`${origin}/api/paysim/v1/checkout/sessions`, {
      method: "POST",
      headers: {
        authorization: "Bearer sk_test_mount",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: encode(paymentSession()).join("&"),
    });
    const s = (await created.json()) as { id: string; url: string };
    expect(s.url).toBe(`${origin}/api/paysim/checkout/${s.id}`);
    const page = await (await fetch(s.url)).text();
    expect(page).toContain(`action="/api/paysim/checkout/${s.id}"`);
    await app.close();
  });
});

describe("the memory store", () => {
  it("rolls a transaction back when it throws", async () => {
    const store = createMemoryPaySimStore();
    const obj = { id: "x", type: "t", account: null, data: { a: 1 }, internal: {}, dueAt: null };
    await expect(
      store.transaction(async (tx) => {
        await tx.put(obj);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await store.listObjects()).toHaveLength(0);
    await store.transaction((tx) => tx.put(obj));
    expect(await store.listObjects()).toHaveLength(1);
  });
});
