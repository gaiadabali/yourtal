/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- tests read dynamic JSON bodies */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBrowser } from "./browser";
import { createPgPaySimStore } from "./pg-store";
import { startPaySimServer } from "./server";
import { CARD_OK, type Params, encode } from "./test-kit";
import type { PaySimStore, StoredObject } from "./store";

/**
 * Against a real Postgres, as the unprivileged app role: the migration's
 * grants, jsonb round trips, rollback, idempotency, SKIP LOCKED claims, and a
 * whole checkout through the HTTP plugin. Run by `pnpm test:pg`
 * (packages/db/scripts/with-test-db.mjs gives it a yourtal_test_* database).
 */
const APP_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"] ?? "";

let pool: pg.Pool;
let store: PaySimStore;
let n = 0;
const uid = (p: string): string => `${p}_${String(Date.now())}_${String((n += 1))}`;
const T0 = new Date("2026-10-20T00:00:00Z");
const at = (s: number): Date => new Date(T0.getTime() + s * 1000);

function obj(over: Partial<StoredObject> = {}): StoredObject {
  return {
    id: uid("o"),
    type: "customer",
    account: null,
    data: { name: "Ann", nested: { list: [1, 2, { a: null }] } },
    internal: { balance: 5 },
    dueAt: null,
    ...over,
  };
}

beforeAll(() => {
  pool = new pg.Pool({ connectionString: APP_URL, max: 8 });
  store = createPgPaySimStore(pool);
});
afterAll(async () => {
  await pool.end();
});

describe("objects", () => {
  it("round-trips jsonb, the account scope and due_at", async () => {
    const o = obj({ account: "acct_x", dueAt: at(30) });
    await store.transaction((tx) => tx.put(o));
    const got = await store.transaction((tx) => tx.get(o.id));
    expect(got).toEqual(o);
    expect(await store.transaction((tx) => tx.get("missing"))).toBeUndefined();
    const updated = { ...o, data: { name: "Bea" }, dueAt: null };
    await store.transaction((tx) => tx.put(updated));
    expect(await store.transaction((tx) => tx.get(o.id, { forUpdate: true }))).toEqual(updated);
    expect((await store.listObjects("customer")).some((x) => x.id === o.id)).toBe(true);
  });

  it("rolls everything back when the transaction throws", async () => {
    const o = obj();
    await expect(
      store.transaction(async (tx) => {
        await tx.put(o);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await store.transaction((tx) => tx.get(o.id))).toBeUndefined();
  });
});

describe("list", () => {
  it("lists a type oldest first, narrowed by account, in insertion order even within one transaction", async () => {
    const type = uid("listed");
    const mine = uid("acct");
    const [a, b, c, d] = [
      obj({ type, account: mine }),
      obj({ type, account: null }),
      obj({ type, account: mine }),
      obj({ type: "other", account: mine }),
    ] as const;
    // Ids are random, so only the insertion clock can order these three.
    await store.transaction(async (tx) => {
      await tx.put(c);
      await tx.put(a);
      await tx.put(b);
      await tx.put(d);
    });
    await store.transaction((tx) => tx.put({ ...c, data: { touched: true } }));
    const ids = (rows: StoredObject[]): string[] => rows.map((x) => x.id);
    expect(ids(await store.transaction((tx) => tx.list(type)))).toEqual([c.id, a.id, b.id]);
    expect(ids(await store.transaction((tx) => tx.list(type, mine)))).toEqual([c.id, a.id]);
    expect(ids(await store.transaction((tx) => tx.list(type, null)))).toEqual([b.id]);
  });
});

describe("idempotency records", () => {
  it("stores by scope and key, and ignores a record older than the cutoff", async () => {
    const key = uid("k");
    const rec = {
      scope: "platform",
      key,
      requestHash: "h",
      status: 200,
      body: '{"a":1}',
      createdAt: at(0),
    };
    await store.transaction((tx) => tx.putIdempotency(rec));
    expect(await store.transaction((tx) => tx.getIdempotency("platform", key, at(-60)))).toEqual(
      rec,
    );
    expect(
      await store.transaction((tx) => tx.getIdempotency("acct_other", key, at(-60))),
    ).toBeUndefined();
    expect(
      await store.transaction((tx) => tx.getIdempotency("platform", key, at(60))),
    ).toBeUndefined();
    await store.transaction((tx) =>
      tx.putIdempotency({ ...rec, requestHash: "h2", createdAt: at(100) }),
    );
    const again = await store.transaction((tx) => tx.getIdempotency("platform", key, at(50)));
    expect(again?.requestHash).toBe("h2");
  });
});

describe("claims across processes", () => {
  it("claimDueObjects uses SKIP LOCKED: a second transaction gets different rows", async () => {
    const mine = Array.from({ length: 4 }, () => obj({ type: "claim_probe", dueAt: at(1) }));
    await store.transaction(async (tx) => {
      for (const o of mine) await tx.put(o);
    });
    const ids = new Set(mine.map((o) => o.id));
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => {
      release = r;
    });
    let firstClaim: string[] = [];
    const first = store.transaction(async (tx) => {
      const rows = await tx.claimDueObjects(at(5), 2);
      firstClaim = rows.map((r) => r.id);
      await held;
      for (const r of rows) await tx.put({ ...r, dueAt: null });
    });
    await new Promise((r) => setTimeout(r, 200));
    const second = await store.transaction(async (tx) => {
      const rows = await tx.claimDueObjects(at(5), 100);
      const own = rows.filter((r) => ids.has(r.id));
      for (const r of own) await tx.put({ ...r, dueAt: null });
      return own.map((r) => r.id);
    });
    release();
    await first;
    expect(firstClaim).toHaveLength(2);
    expect(second.filter((id) => firstClaim.includes(id))).toEqual([]);
    expect(new Set([...firstClaim, ...second]).size).toBe(4);
  });

  it("deliveries are leased, so two workers do not send the same one", async () => {
    const event = obj({
      type: "event",
      data: { id: "evt_1", created: Math.floor(T0.getTime() / 1000) },
    });
    const d1 = uid("whd");
    const d2 = uid("whd");
    await store.transaction(async (tx) => {
      await tx.put(event);
      await tx.enqueueDelivery({ id: d1, eventId: event.id, nextAttemptAt: at(0), now: at(0) });
      await tx.enqueueDelivery({ id: d2, eventId: event.id, nextAttemptAt: at(0), now: at(0) });
    });
    const [a, b] = await Promise.all([
      store.claimDeliveries(at(1), 100, 60_000),
      store.claimDeliveries(at(1), 100, 60_000),
    ]);
    const mine = [...a, ...b].map((d) => d.id).filter((id) => id === d1 || id === d2);
    expect(mine.sort()).toEqual([d1, d2].sort());
    const claimed = [...a, ...b].find((d) => d.id === d1);
    expect(claimed?.event).toMatchObject({ id: "evt_1" });
    expect(claimed?.eventCreatedAt).toEqual(T0);
    // Leased until at(61); nothing is due before that.
    const early = await store.claimDeliveries(at(30), 100, 60_000);
    expect(early.filter((d) => d.id === d1 || d.id === d2)).toEqual([]);
    await store.recordDelivery(
      d1,
      {
        attempts: 1,
        status: "pending",
        nextAttemptAt: at(70),
        lastStatusCode: 500,
        lastError: "HTTP 500",
      },
      at(62),
    );
    const late = await store.claimDeliveries(at(120), 100, 60_000);
    expect(late.map((d) => d.id)).toContain(d1);
    await store.recordDelivery(
      d1,
      {
        attempts: 2,
        status: "delivered",
        nextAttemptAt: at(120),
        lastStatusCode: 200,
        lastError: null,
      },
      at(121),
    );
    const rows = await store.listDeliveries();
    expect(rows.find((d) => d.id === d1)).toMatchObject({
      status: "delivered",
      attempts: 2,
      lastStatusCode: 200,
    });
  });
});

describe("the whole simulation on Postgres", () => {
  const form = (p: Params): string => encode(p).join("&");

  it("runs a checkout, a webhook delivery and a payout against the database", async () => {
    const hooks: string[] = [];
    let clock = new Date();
    const sim = await startPaySimServer({
      store,
      now: () => clock,
      fetch: (_u, init) => {
        hooks.push(typeof init?.body === "string" ? init.body : "");
        return Promise.resolve(new Response("ok"));
      },
    });
    const headers = {
      authorization: `Bearer ${sim.secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
    };
    const post = async (path: string, p: Params, extra: Record<string, string> = {}) =>
      (
        await fetch(`${sim.baseUrl}${path}`, {
          method: "POST",
          headers: { ...headers, ...extra },
          body: form(p),
        })
      ).json() as Promise<Record<string, any>>;

    const s = await post("/v1/checkout/sessions", {
      mode: "payment",
      success_url: "https://app.test/ok",
      line_items: [
        {
          quantity: 1,
          price_data: { currency: "aud", unit_amount: 4500, product_data: { name: "V" } },
        },
      ],
    });
    const done = await createBrowser(sim.config.publicBaseUrl).submitCheckout(s["id"], CARD_OK);
    expect(done.status).toBe(303);
    const got = (await (
      await fetch(`${sim.baseUrl}/v1/checkout/sessions/${s["id"]}?expand[]=payment_intent`, {
        headers,
      })
    ).json()) as Record<string, any>;
    expect(got["payment_status"]).toBe("paid");
    expect(got["payment_intent"].status).toBe("succeeded");
    expect((await sim.tick()).delivered).toBeGreaterThanOrEqual(2);
    expect(hooks.some((b) => b.includes("checkout.session.completed"))).toBe(true);

    // Concurrent requests with one idempotency key create one customer.
    const key = uid("idem");
    const [c1, c2] = await Promise.all([
      post("/v1/customers", { email: "idem@example.test" }, { "idempotency-key": key }),
      post("/v1/customers", { email: "idem@example.test" }, { "idempotency-key": key }),
    ]);
    expect(c1["id"]).toBe(c2["id"]);

    // Connect: onboard, transfer, payout, sweep to paid.
    const acct = await post("/v1/accounts", {
      type: "express",
      capabilities: { transfers: { requested: true } },
      settings: { payouts: { schedule: { interval: "manual" } } },
    });
    const link = await post("/v1/account_links", {
      account: acct["id"],
      type: "account_onboarding",
      refresh_url: "https://app.test/r",
      return_url: "https://app.test/x",
    });
    const browser = createBrowser(sim.config.publicBaseUrl);
    await browser.completeOnboarding((link["url"] as string).split("/").pop() ?? "", {
      bsb: "110000",
      account: "000123456",
    });
    await post("/v1/transfers", { amount: 3000, currency: "aud", destination: acct["id"] });
    const po = await post(
      "/v1/payouts",
      { amount: 3000, currency: "aud" },
      { "stripe-account": acct["id"] },
    );
    expect(po["status"]).toBe("pending");
    clock = new Date(clock.getTime() + 31_000);
    await sim.tick();
    const paid = (await (
      await fetch(`${sim.baseUrl}/v1/payouts/${po["id"]}`, {
        headers: { ...headers, "stripe-account": acct["id"] },
      })
    ).json()) as Record<string, any>;
    expect(paid["status"]).toBe("paid");
    await sim.close();
  });
});
