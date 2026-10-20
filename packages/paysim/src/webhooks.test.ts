/* eslint-disable @typescript-eslint/no-explicit-any -- tests read dynamic JSON bodies */
import { createHmac, timingSafeEqual } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPaySimDispatcher } from "./dispatcher";
import { createMemoryPaySimStore } from "./memory-store";
import { startPaySimServer } from "./server";
import { type Kit, makeKit, paymentSession } from "./test-kit";
import { nextAttemptAt } from "./webhooks";

/**
 * A receiver written from Stripe's documented scheme, independent of the
 * signer: header `t=<unix>,v1=<hex>`, HMAC-SHA256 over "<t>.<raw body>",
 * 300 s tolerance, any matching v1, constant-time compare.
 */
function verify(secret: string, header: string, body: string, nowS: number): boolean {
  const parts = header.split(",").map((p) => p.split("=") as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  if (!Number.isFinite(t) || Math.abs(nowS - t) > 300) return false;
  const want = createHmac("sha256", secret).update(`${t}.${body}`).digest();
  return parts
    .filter(([k]) => k === "v1")
    .some(([, v]) => {
      const got = Buffer.from(v, "hex");
      return got.length === want.length && timingSafeEqual(got, want);
    });
}

let k: Kit;
beforeAll(async () => {
  k = await makeKit();
});
afterAll(async () => {
  await k.sim.close();
});

const nowS = (): number => Math.floor(k.now().getTime() / 1000);

async function newEvent(): Promise<string> {
  const s = await k.post("/v1/checkout/sessions", paymentSession());
  await k.post(`/v1/checkout/sessions/${s.json["id"]}/expire`);
  return s.json["id"] as string;
}

describe("webhook delivery", () => {
  it("posts the event as JSON with a signature an independent verifier accepts", async () => {
    k.hooks.length = 0;
    await newEvent();
    const tick = await k.sim.tick();
    expect(tick.delivered).toBe(1);
    const hook = k.hooks[0];
    expect(hook?.url).toBe("http://receiver.test/hook");
    expect(hook?.headers["content-type"]).toBe("application/json; charset=utf-8");
    const sig = hook?.headers["stripe-signature"] ?? "";
    expect(sig).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(verify(k.sim.webhookSecret, sig, hook?.body ?? "", nowS())).toBe(true);
    // A tampered body, the wrong secret and a stale timestamp all fail.
    expect(verify(k.sim.webhookSecret, sig, `${hook?.body ?? ""} `, nowS())).toBe(false);
    expect(verify("whsec_other", sig, hook?.body ?? "", nowS())).toBe(false);
    expect(verify(k.sim.webhookSecret, sig, hook?.body ?? "", nowS() + 301)).toBe(false);
    const event = JSON.parse(hook?.body ?? "{}") as Record<string, any>;
    expect(event).toMatchObject({
      object: "event",
      type: "checkout.session.expired",
      livemode: false,
      pending_webhooks: 1,
      api_version: "2024-06-20",
    });
    expect(event["id"]).toMatch(/^evt_/);
    expect(event["data"].object.object).toBe("checkout.session");
    const deliveries = await k.sim.store.listDeliveries();
    expect(deliveries.at(-1)).toMatchObject({
      status: "delivered",
      attempts: 1,
      lastStatusCode: 200,
    });
  });

  it("does not resend a delivered event", async () => {
    k.hooks.length = 0;
    await k.sim.tick();
    await k.sim.tick();
    expect(k.hooks).toHaveLength(0);
  });

  it("retries on 10 s, 1 min, 5 min, 30 min, 2 h, 6 h, then every 12 h, re-signing each time", async () => {
    const hooksBefore = k.hooks.length;
    k.respondWith.status = 500;
    await newEvent();
    const created = k.now();
    const gaps = [10, 60, 300, 1800, 7200, 21600, 43200, 43200];
    const attemptTimes: Date[] = [];
    for (const gap of [0, ...gaps]) {
      k.advance(gap * 1000);
      const before = k.hooks.length;
      await k.sim.tick();
      if (k.hooks.length > before) attemptTimes.push(k.now());
    }
    expect(k.hooks.length - hooksBefore).toBe(9);
    const offsets = attemptTimes.map((t) => (t.getTime() - created.getTime()) / 1000);
    expect(offsets).toEqual([0, 10, 70, 370, 2170, 9370, 30970, 74170, 117370].slice(0, 9));
    // Each attempt carries its own timestamp and a valid signature.
    const sigs = k.hooks.slice(hooksBefore).map((h) => h.headers["stripe-signature"] ?? "");
    expect(new Set(sigs).size).toBe(sigs.length);
    for (const [i, h] of k.hooks.slice(hooksBefore).entries()) {
      const t = Number(/t=(\d+)/.exec(h.headers["stripe-signature"] ?? "")?.[1]);
      expect(verify(k.sim.webhookSecret, h.headers["stripe-signature"] ?? "", h.body, t)).toBe(
        true,
      );
      expect(t).toBe(Math.floor((created.getTime() + (offsets[i] ?? 0) * 1000) / 1000));
    }
  });

  it("is marked delivered once a retry gets a 2xx", async () => {
    k.respondWith.status = 503;
    k.hooks.length = 0;
    await newEvent();
    await k.sim.tick();
    expect(k.hooks).toHaveLength(1);
    k.respondWith.status = 200;
    k.advance(9_000);
    await k.sim.tick();
    expect(k.hooks).toHaveLength(1);
    k.advance(1_000);
    await k.sim.tick();
    expect(k.hooks).toHaveLength(2);
    expect((await k.sim.store.listDeliveries()).at(-1)).toMatchObject({
      status: "delivered",
      attempts: 2,
    });
  });

  it("gives up and marks the delivery failed three days after the event", async () => {
    k.respondWith.status = 500;
    k.hooks.length = 0;
    await newEvent();
    const created = k.now().getTime();
    // Jump the clock to each retry in turn until the delivery stops being pending.
    for (let i = 0; i < 30; i += 1) {
      const d = (await k.sim.store.listDeliveries()).at(-1);
      if (d?.status !== "pending") break;
      k.advance(Math.max(0, d.nextAttemptAt.getTime() - k.now().getTime()));
      await k.sim.tick();
    }
    const last = (await k.sim.store.listDeliveries()).at(-1);
    expect(last?.status).toBe("failed");
    expect(last?.attempts).toBe(12);
    const sentAt = k.hooks.map(
      (h) => Number(/t=(\d+)/.exec(h.headers["stripe-signature"] ?? "")?.[1]) * 1000,
    );
    expect(Math.max(...sentAt)).toBeLessThanOrEqual(created + 72 * 3600 * 1000);
    const count = k.hooks.length;
    k.advance(24 * 3600 * 1000);
    await k.sim.tick();
    expect(k.hooks).toHaveLength(count);
    k.respondWith.status = 200;
  });

  it("treats a timeout or network error like a failure", async () => {
    const store = createMemoryPaySimStore();
    let t = new Date("2026-10-20T00:00:00Z");
    let calls = 0;
    const sim = await startPaySimServer({
      store,
      now: () => t,
      fetch: () => {
        calls += 1;
        return Promise.reject(new TypeError("fetch failed"));
      },
    });
    const s = await fetch(`${sim.baseUrl}/v1/checkout/sessions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${sim.secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "mode=payment&success_url=https%3A%2F%2Fa.test&line_items[0][price_data][currency]=aud&line_items[0][price_data][unit_amount]=1000&line_items[0][price_data][product_data][name]=x",
    });
    const id = ((await s.json()) as { id: string }).id;
    await fetch(`${sim.baseUrl}/v1/checkout/sessions/${id}/expire`, {
      method: "POST",
      headers: { authorization: `Bearer ${sim.secretKey}` },
    });
    await sim.tick();
    expect(calls).toBe(1);
    expect((await store.listDeliveries())[0]).toMatchObject({
      status: "pending",
      attempts: 1,
      lastError: "TypeError",
    });
    t = new Date(t.getTime() + 10_000);
    await sim.tick();
    expect(calls).toBe(2);
    await sim.close();
  });
});

describe("the retry schedule", () => {
  const event = new Date("2026-10-20T00:00:00Z");
  it("returns the documented delays", () => {
    const delays = [1, 2, 3, 4, 5, 6, 7, 8].map(
      (n) => (nextAttemptAt(n, event, event)?.getTime() ?? 0) - event.getTime(),
    );
    expect(delays).toEqual([
      10_000, 60_000, 300_000, 1_800_000, 7_200_000, 21_600_000, 43_200_000, 43_200_000,
    ]);
  });

  it("gives up when the next attempt would fall beyond three days", () => {
    const at = (hours: number, extraMs = 0) =>
      new Date(event.getTime() + hours * 3600_000 + extraMs);
    expect(nextAttemptAt(9, event, at(59))).not.toBeNull();
    expect(nextAttemptAt(9, event, at(60))).not.toBeNull();
    expect(nextAttemptAt(9, event, at(60, 1))).toBeNull();
  });
});

describe("the dispatcher loop", () => {
  it("runs ticks until stopped, and stop() waits for the one in flight", async () => {
    const store = createMemoryPaySimStore();
    let calls = 0;
    const dispatcher = startPaySimDispatcher({
      store,
      config: {
        appEnv: "dev",
        secretKey: "sk",
        webhookSecret: "wh",
        webhookUrl: "http://x.test/h",
        publicBaseUrl: "http://x.test",
        accountName: "A",
      },
      intervalMs: 5,
      fetch: () => {
        calls += 1;
        return Promise.resolve(new Response("ok"));
      },
    });
    await new Promise((r) => setTimeout(r, 40));
    await dispatcher.stop();
    expect(calls).toBe(0);
    const errors: unknown[] = [];
    const broken = startPaySimDispatcher({
      store: { ...store, claimDeliveries: () => Promise.reject(new Error("db down")) },
      config: {
        appEnv: "dev",
        secretKey: "sk",
        webhookSecret: "wh",
        webhookUrl: "http://x.test/h",
        publicBaseUrl: "http://x.test",
        accountName: "A",
      },
      intervalMs: 5,
      onError: (e) => errors.push(e),
    });
    await new Promise((r) => setTimeout(r, 40));
    await broken.stop();
    expect(errors.length).toBeGreaterThan(1);
  });
});
