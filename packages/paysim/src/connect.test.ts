/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- tests read dynamic JSON bodies */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Kit, makeKit, onboardedAccount } from "./test-kit";

let k: Kit;
beforeAll(async () => {
  k = await makeKit();
});
afterAll(async () => {
  await k.sim.close();
});

const manual = { settings: { payouts: { schedule: { interval: "manual" } } } };

async function link(
  account: string,
  type = "account_onboarding",
): Promise<{ token: string; json: Record<string, any> }> {
  const res = await k.post("/v1/account_links", {
    account,
    type,
    refresh_url: "https://app.test/refresh",
    return_url: "https://app.test/return",
  });
  return { token: (res.json["url"] as string).split("/").pop() ?? "", json: res.json };
}

const asAccount = (id: string) => ({ "stripe-account": id });

describe("accounts", () => {
  it("creates an Express account with the contract's shape", async () => {
    const res = await k.post("/v1/accounts", {
      type: "express",
      country: "AU",
      email: "biz@example.test",
      business_type: "company",
      capabilities: { transfers: { requested: true }, card_payments: { requested: true } },
      settings: { payouts: { schedule: { interval: "manual" } } },
      metadata: { business: "b1" },
    });
    expect(res.status).toBe(200);
    expect(res.json["id"]).toMatch(/^acct_[0-9A-Za-z]{24}$/);
    expect(res.json).toMatchObject({
      object: "account",
      type: "express",
      country: "AU",
      email: "biz@example.test",
      business_type: "company",
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      capabilities: { transfers: "inactive", card_payments: "inactive" },
      external_accounts: { object: "list", data: [] },
      settings: { payouts: { schedule: { interval: "manual" } } },
      metadata: { business: "b1" },
    });
    expect(res.json["requirements"].currently_due.length).toBeGreaterThan(0);
    const got = await k.get(`/v1/accounts/${res.json["id"]}`);
    expect(got.json["id"]).toBe(res.json["id"]);
  });

  it("validates type, country, business_type and schedule, and defaults to daily", async () => {
    expect((await k.post("/v1/accounts", { country: "AU" })).json["error"].code).toBe(
      "parameter_missing",
    );
    expect((await k.post("/v1/accounts", { type: "standard" })).status).toBe(400);
    expect((await k.post("/v1/accounts", { type: "express", country: "US" })).status).toBe(400);
    expect((await k.post("/v1/accounts", { type: "express", business_type: "club" })).status).toBe(
      400,
    );
    const bad = await k.post("/v1/accounts", {
      type: "express",
      settings: { payouts: { schedule: { interval: "weekly" } } },
    });
    expect(bad.status).toBe(400);
    const dflt = await k.post("/v1/accounts", { type: "express" });
    expect(dflt.json["settings"].payouts.schedule.interval).toBe("daily");
    expect((await k.get("/v1/accounts/acct_ghost")).status).toBe(404);
  });
});

describe("account links and the onboarding page", () => {
  it("returns a 30 minute link to the simulation's page", async () => {
    const acct = await k.post("/v1/accounts", { type: "express" });
    const l = await link(acct.json["id"]);
    expect(l.json).toMatchObject({ object: "account_link" });
    expect(l.json["expires_at"] - l.json["created"]).toBe(1800);
    expect(l.json["url"]).toBe(`${k.sim.baseUrl}/connect/onboarding/${l.token}`);
    expect(l.token.length).toBeGreaterThan(40);
    const page = await k.browser.get(`/connect/onboarding/${l.token}`);
    expect(page.status).toBe(200);
    expect(page.html).toContain("Simulated onboarding, no real money");
    const res = await fetch(`${k.sim.config.publicBaseUrl}/connect/onboarding/${l.token}`);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("form-action 'self' https://app.test");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("validates its params", async () => {
    const acct = await k.post("/v1/accounts", { type: "express" });
    const base = {
      account: acct.json["id"],
      type: "account_onboarding",
      refresh_url: "https://a.test/r",
      return_url: "https://a.test/x",
    };
    expect((await k.post("/v1/account_links", { ...base, account: "acct_ghost" })).status).toBe(
      404,
    );
    expect((await k.post("/v1/account_links", { ...base, type: "weird" })).status).toBe(400);
    expect((await k.post("/v1/account_links", { ...base, return_url: "ftp://x" })).status).toBe(
      400,
    );
    const { refresh_url: _r, ...noRefresh } = base;
    expect((await k.post("/v1/account_links", noRefresh)).json["error"].param).toBe("refresh_url");
  });

  it("onboards with the success bank account and emits account.updated", async () => {
    const acct = await k.post("/v1/accounts", {
      type: "express",
      capabilities: { transfers: { requested: true }, card_payments: { requested: true } },
    });
    const id = acct.json["id"] as string;
    const l = await link(id);
    const res = await k.browser.completeOnboarding(l.token, {
      bsb: "110-000",
      account: "000 123 456",
    });
    expect(res.status).toBe(303);
    expect(res.location).toBe("https://app.test/return");
    const got = await k.get(`/v1/accounts/${id}`);
    expect(got.json).toMatchObject({
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      capabilities: { transfers: "active", card_payments: "active" },
      requirements: { currently_due: [] },
    });
    const ba = got.json["external_accounts"].data[0];
    expect(ba).toMatchObject({
      object: "bank_account",
      last4: "3456",
      routing_number: "110000",
      currency: "aud",
    });
    expect(ba.id).toMatch(/^ba_/);
    const ev = (await k.sim.store.listObjects("event")).find(
      (e) => e.data["type"] === "account.updated" && e.data["account"] === id,
    );
    expect(ev).toBeDefined();
    expect(JSON.stringify(await k.sim.store.listObjects())).not.toContain("000123456");
  });

  it("refuses unknown bank accounts and a missing name, creating nothing", async () => {
    const acct = await k.post("/v1/accounts", { type: "express" });
    const l = await link(acct.json["id"]);
    const wrong = await k.browser.completeOnboarding(l.token, {
      bsb: "110000",
      account: "123456789",
    });
    expect(wrong.status).toBe(200);
    expect(wrong.html).toContain("Use one of Stripe&#39;s test bank accounts.");
    const badBsb = await k.browser.completeOnboarding(l.token, {
      bsb: "062000",
      account: "000123456",
    });
    expect(badBsb.html).toContain("test bank accounts");
    const noName = await k.browser.completeOnboarding(l.token, {
      name: " ",
      bsb: "110000",
      account: "000123456",
    });
    expect(noName.html).toContain("Enter a legal name.");
    expect((await k.get(`/v1/accounts/${acct.json["id"]}`)).json["charges_enabled"]).toBe(false);
  });

  it("an expired link redirects to refresh_url, and so does a used one", async () => {
    const acct = await k.post("/v1/accounts", { type: "express" });
    const l = await link(acct.json["id"]);
    const csrf = await k.browser.csrfFrom(`/connect/onboarding/${l.token}`);
    k.advance(31 * 60 * 1000);
    const expired = await k.browser.get(`/connect/onboarding/${l.token}`);
    expect(expired.status).toBe(303);
    expect(expired.location).toBe("https://app.test/refresh");
    const post = await fetch(`${k.sim.config.publicBaseUrl}/connect/onboarding/${l.token}`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        csrf,
        legal_name: "N",
        bsb: "110000",
        account: "000123456",
      }).toString(),
    });
    expect(post.status).toBe(303);
    expect(post.headers.get("location")).toBe("https://app.test/refresh");
    expect((await k.get(`/v1/accounts/${acct.json["id"]}`)).json["charges_enabled"]).toBe(false);

    const fresh = await link(acct.json["id"]);
    await k.browser.completeOnboarding(fresh.token, { bsb: "110000", account: "000123456" });
    const reused = await k.browser.get(`/connect/onboarding/${fresh.token}`);
    expect(reused.location).toBe("https://app.test/refresh");
  });

  it("needs the page's CSRF token, and unknown tokens are 404", async () => {
    const acct = await k.post("/v1/accounts", { type: "express" });
    const l = await link(acct.json["id"]);
    const res = await fetch(`${k.sim.config.publicBaseUrl}/connect/onboarding/${l.token}`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        csrf: "x",
        legal_name: "N",
        bsb: "110000",
        account: "000123456",
      }).toString(),
    });
    expect(res.status).toBe(404);
    expect((await k.browser.get("/connect/onboarding/acl_ghost")).status).toBe(404);
  });
});

describe("transfers and balance", () => {
  it("credits the destination's balance, emits transfer.created, and does not enforce the platform balance", async () => {
    const id = await onboardedAccount(k, "000123456", manual);
    const before = (await k.get("/v1/balance")).json["available"][0].amount as number;
    const res = await k.post("/v1/transfers", {
      amount: 7000,
      currency: "aud",
      destination: id,
      transfer_group: "stmt-1",
      description: "Statement",
      metadata: { statement: "s1" },
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      object: "transfer",
      amount: 7000,
      currency: "aud",
      destination: id,
      reversed: false,
      metadata: { statement: "s1" },
      transfer_group: "stmt-1",
    });
    expect(res.json["id"]).toMatch(/^tr_/);
    const own = await k.get("/v1/balance", {}, asAccount(id));
    expect(own.json).toMatchObject({
      object: "balance",
      available: [{ amount: 7000, currency: "aud" }],
      pending: [{ amount: 0, currency: "aud" }],
    });
    expect((await k.get("/v1/balance")).json["available"][0].amount).toBe(before - 7000);
    const types = (await k.sim.store.listObjects("event")).map((e) => e.data["type"]);
    expect(types).toContain("transfer.created");
  });

  it("needs the transfers capability on the destination", async () => {
    const noCap = await k.post("/v1/accounts", { type: "express" });
    const res = await k.post("/v1/transfers", {
      amount: 1000,
      currency: "aud",
      destination: noCap.json["id"],
    });
    expect(res.status).toBe(400);
    expect(res.json["error"]).toMatchObject({
      type: "invalid_request_error",
      code: "insufficient_capabilities_for_transfer",
    });
    const requested = await k.post("/v1/accounts", {
      type: "express",
      capabilities: { transfers: { requested: true } },
    });
    expect(
      (
        await k.post("/v1/transfers", {
          amount: 1000,
          currency: "aud",
          destination: requested.json["id"],
        })
      ).status,
    ).toBe(400);
  });

  it("validates amount, currency and destination", async () => {
    const id = await onboardedAccount(k, "000123456", manual);
    expect(
      (await k.post("/v1/transfers", { currency: "aud", destination: id })).json["error"].param,
    ).toBe("amount");
    expect(
      (await k.post("/v1/transfers", { amount: 10, currency: "aud" })).json["error"].param,
    ).toBe("destination");
    expect(
      (await k.post("/v1/transfers", { amount: 10, currency: "aud", destination: "acct_ghost" }))
        .status,
    ).toBe(404);
    expect(
      (await k.post("/v1/transfers", { amount: 10, currency: "usd", destination: id })).status,
    ).toBe(400);
    expect(
      (await k.post("/v1/transfers", { amount: 10, destination: id })).json["error"].param,
    ).toBe("currency");
    // Transfers have no 50 cent minimum.
    expect(
      (await k.post("/v1/transfers", { amount: 1, currency: "aud", destination: id })).status,
    ).toBe(200);
  });
});

describe("payouts", () => {
  async function funded(account: string, amount = 10_000): Promise<string> {
    const id = await onboardedAccount(k, account, manual);
    await k.post("/v1/transfers", { amount, currency: "aud", destination: id });
    return id;
  }

  it("is created pending, takes the balance now, and is paid about 30 s later", async () => {
    const id = await funded("000123456");
    const res = await k.post(
      "/v1/payouts",
      { amount: 4000, currency: "aud", description: "Cash out", metadata: { r: "1" } },
      asAccount(id),
    );
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      object: "payout",
      amount: 4000,
      currency: "aud",
      status: "pending",
      description: "Cash out",
      metadata: { r: "1" },
      failure_code: null,
      failure_message: null,
    });
    expect(res.json["id"]).toMatch(/^po_/);
    expect(res.json["destination"]).toMatch(/^ba_/);
    expect((await k.get("/v1/balance", {}, asAccount(id))).json["available"][0].amount).toBe(6000);
    await k.sim.tick();
    expect((await k.get(`/v1/payouts/${res.json["id"]}`, {}, asAccount(id))).json["status"]).toBe(
      "pending",
    );
    k.advance(31_000);
    await k.sim.tick();
    expect((await k.get(`/v1/payouts/${res.json["id"]}`, {}, asAccount(id))).json["status"]).toBe(
      "paid",
    );
    const paid = (await k.sim.store.listObjects("event")).find(
      (e) => e.data["type"] === "payout.paid" && e.data["account"] === id,
    );
    expect(paid).toBeDefined();
    expect((await k.get("/v1/balance", {}, asAccount(id))).json["available"][0].amount).toBe(6000);
  });

  it.each([
    ["111111116", "no_account"],
    ["111111113", "account_closed"],
  ])("fails for bank account %s with %s and returns the amount", async (account, code) => {
    const id = await funded(account);
    const res = await k.post("/v1/payouts", { amount: 2500, currency: "aud" }, asAccount(id));
    k.advance(31_000);
    await k.sim.tick();
    const got = await k.get(`/v1/payouts/${res.json["id"]}`, {}, asAccount(id));
    expect(got.json).toMatchObject({ status: "failed", failure_code: code });
    expect(got.json["failure_message"]).toEqual(expect.any(String));
    expect((await k.get("/v1/balance", {}, asAccount(id))).json["available"][0].amount).toBe(
      10_000,
    );
    const failed = (await k.sim.store.listObjects("event")).find(
      (e) => e.data["type"] === "payout.failed" && e.data["account"] === id,
    );
    expect(failed).toBeDefined();
  });

  it("refuses more than the available balance", async () => {
    const id = await funded("000123456", 1000);
    const res = await k.post("/v1/payouts", { amount: 1001, currency: "aud" }, asAccount(id));
    expect(res.status).toBe(400);
    expect(res.json["error"].code).toBe("balance_insufficient");
    expect((await k.get("/v1/balance", {}, asAccount(id))).json["available"][0].amount).toBe(1000);
  });

  it("needs a connected account scope, an onboarded account and valid params", async () => {
    expect((await k.post("/v1/payouts", { amount: 100, currency: "aud" })).status).toBe(400);
    const raw = await k.post("/v1/accounts", { type: "express" });
    expect(
      (await k.post("/v1/payouts", { amount: 100, currency: "aud" }, asAccount(raw.json["id"])))
        .status,
    ).toBe(400);
    const id = await funded("000123456");
    expect(
      (await k.post("/v1/payouts", { currency: "aud" }, asAccount(id))).json["error"].param,
    ).toBe("amount");
    expect(
      (await k.post("/v1/payouts", { amount: 0, currency: "aud" }, asAccount(id))).status,
    ).toBe(400);
  });

  it("is only visible with its own Stripe-Account scope", async () => {
    const a = await funded("000123456");
    const b = await funded("000123456");
    const po = await k.post("/v1/payouts", { amount: 100, currency: "aud" }, asAccount(a));
    expect((await k.get(`/v1/payouts/${po.json["id"]}`)).status).toBe(404);
    expect((await k.get(`/v1/payouts/${po.json["id"]}`, {}, asAccount(b))).status).toBe(404);
    expect((await k.get(`/v1/payouts/${po.json["id"]}`, {}, asAccount(a))).status).toBe(200);
  });

  it("sweeps a daily account's whole balance into a payout, and a manual one is left alone", async () => {
    const daily = await onboardedAccount(k);
    const hand = await onboardedAccount(k, "000123456", manual);
    await k.post("/v1/transfers", { amount: 3300, currency: "aud", destination: daily });
    await k.post("/v1/transfers", { amount: 3300, currency: "aud", destination: hand });
    await k.sim.tick();
    expect((await k.get("/v1/balance", {}, asAccount(daily))).json["available"][0].amount).toBe(0);
    expect((await k.get("/v1/balance", {}, asAccount(hand))).json["available"][0].amount).toBe(
      3300,
    );
    const payouts = (await k.sim.store.listObjects("payout")).filter((p) => p.account === daily);
    expect(payouts).toHaveLength(1);
    expect(payouts[0]?.data).toMatchObject({ amount: 3300, status: "pending", metadata: {} });
    k.advance(31_000);
    await k.sim.tick();
    expect(
      (await k.sim.store.listObjects("payout")).filter((p) => p.account === daily)[0]?.data[
        "status"
      ],
    ).toBe("paid");
  });

  it("a failing daily payout returns the money without looping", async () => {
    const id = await onboardedAccount(k, "111111116");
    await k.post("/v1/transfers", { amount: 1200, currency: "aud", destination: id });
    await k.sim.tick();
    k.advance(31_000);
    await k.sim.tick();
    await k.sim.tick();
    const payouts = (await k.sim.store.listObjects("payout")).filter((p) => p.account === id);
    expect(payouts).toHaveLength(1);
    expect(payouts[0]?.data["status"]).toBe("failed");
    expect((await k.get("/v1/balance", {}, asAccount(id))).json["available"][0].amount).toBe(1200);
  });
});

describe("events", () => {
  it("retrieves an event by id, and hides a connected-account event from the platform scope", async () => {
    const id = await onboardedAccount(k);
    const events = await k.sim.store.listObjects("event");
    const updated = events.find(
      (e) => e.data["type"] === "account.updated" && e.data["account"] === id,
    );
    const evtId = updated?.data["id"] as string;
    expect((await k.get(`/v1/events/${evtId}`)).status).toBe(404);
    const got = await k.get(`/v1/events/${evtId}`, {}, asAccount(id));
    expect(got.json).toMatchObject({
      object: "event",
      type: "account.updated",
      livemode: false,
      pending_webhooks: 1,
      account: id,
      api_version: "2024-06-20",
      request: { id: null, idempotency_key: null },
    });
    expect(got.json["data"].object.id).toBe(id);
    const platformEvent = events.find(
      (e) =>
        e.data["type"] === "transfer.created" || e.data["type"] === "checkout.session.completed",
    );
    if (platformEvent !== undefined) {
      expect((await k.get(`/v1/events/${platformEvent.data["id"] as string}`)).status).toBe(200);
    }
    expect((await k.get("/v1/events/evt_ghost")).status).toBe(404);
  });
});

describe("list payouts and transfers", () => {
  async function account(): Promise<string> {
    return onboardedAccount(k, "000123456", manual);
  }
  const ids = (res: { json: Record<string, any> }): string[] =>
    (res.json["data"] as { id: string }[]).map((o) => o.id);

  it("lists a connected account's payouts only, newest first, as GET /:id returns them", async () => {
    const a = await account();
    const b = await account();
    await k.post("/v1/transfers", { amount: 9000, currency: "aud", destination: a });
    await k.post("/v1/transfers", { amount: 9000, currency: "aud", destination: b });
    // Same second: the later-inserted payout must come first.
    const p1 = await k.post("/v1/payouts", { amount: 100, currency: "aud" }, asAccount(a));
    const p2 = await k.post("/v1/payouts", { amount: 200, currency: "aud" }, asAccount(a));
    k.advance(5_000);
    const p3 = await k.post(
      "/v1/payouts",
      { amount: 300, currency: "aud", metadata: { reference: "r3" } },
      asAccount(a),
    );
    const other = await k.post("/v1/payouts", { amount: 400, currency: "aud" }, asAccount(b));

    const res = await k.get("/v1/payouts", {}, asAccount(a));
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ object: "list", url: "/v1/payouts", has_more: false });
    expect(ids(res)).toStrictEqual([p3.json["id"], p2.json["id"], p1.json["id"]]);
    expect(res.json["data"][0]).toStrictEqual(
      (await k.get(`/v1/payouts/${p3.json["id"]}`, {}, asAccount(a))).json,
    );
    expect(ids(await k.get("/v1/payouts", {}, asAccount(b)))).toStrictEqual([other.json["id"]]);
  });

  it("filters payouts by created and pages with limit and starting_after", async () => {
    const a = await account();
    await k.post("/v1/transfers", { amount: 9000, currency: "aud", destination: a });
    const made: string[] = [];
    const times: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      k.advance(10_000);
      const po = await k.post("/v1/payouts", { amount: 100 + i, currency: "aud" }, asAccount(a));
      made.push(po.json["id"]);
      times.push(po.json["created"]);
    }
    const newest = [...made].reverse();
    expect(
      ids(await k.get("/v1/payouts", { created: { gte: times[1] } }, asAccount(a))),
    ).toStrictEqual([made[2], made[1]]);
    expect(
      ids(await k.get("/v1/payouts", { created: { gt: times[1] } }, asAccount(a))),
    ).toStrictEqual([made[2]]);
    expect(
      ids(await k.get("/v1/payouts", { created: { lt: times[1] } }, asAccount(a))),
    ).toStrictEqual([made[0]]);
    expect(
      ids(await k.get("/v1/payouts", { created: { lte: times[1] } }, asAccount(a))),
    ).toStrictEqual([made[1], made[0]]);

    const first = await k.get("/v1/payouts", { limit: 2 }, asAccount(a));
    expect(ids(first)).toStrictEqual(newest.slice(0, 2));
    expect(first.json["has_more"]).toBe(true);
    const second = await k.get(
      "/v1/payouts",
      { limit: 2, starting_after: newest[1] },
      asAccount(a),
    );
    expect(ids(second)).toStrictEqual(newest.slice(2));
    expect(second.json["has_more"]).toBe(false);
  });

  it("refuses a bad limit, an unknown cursor, and a payout list without Stripe-Account", async () => {
    const a = await account();
    for (const limit of [0, 101, "x"]) {
      const bad = await k.get("/v1/payouts", { limit }, asAccount(a));
      expect(bad.status).toBe(400);
      expect(bad.json["error"].param).toBe("limit");
    }
    const ghost = await k.get("/v1/payouts", { starting_after: "po_ghost" }, asAccount(a));
    expect(ghost.status).toBe(404);
    expect(ghost.json["error"].code).toBe("resource_missing");
    const bare = await k.get("/v1/payouts");
    expect(bare.status).toBe(400);
    expect(bare.json["error"].type).toBe("invalid_request_error");
    expect((await k.get("/v1/transfers", { limit: 0 })).status).toBe(400);
  });

  it("lists platform transfers, filtered by destination, created and transfer_group", async () => {
    const a = await account();
    const b = await account();
    const t1 = await k.post("/v1/transfers", {
      amount: 100,
      currency: "aud",
      destination: a,
      transfer_group: "g1",
    });
    const t2 = await k.post("/v1/transfers", { amount: 200, currency: "aud", destination: b });
    k.advance(10_000);
    const t3 = await k.post("/v1/transfers", {
      amount: 300,
      currency: "aud",
      destination: a,
      metadata: { reference: "disbursement:1" },
    });

    const all = await k.get("/v1/transfers", { destination: a });
    expect(all.json).toMatchObject({ object: "list", url: "/v1/transfers", has_more: false });
    expect(ids(all)).toStrictEqual([t3.json["id"], t1.json["id"]]);
    expect(all.json["data"][0]).toStrictEqual(t3.json);
    expect(ids(await k.get("/v1/transfers", { destination: b }))).toStrictEqual([t2.json["id"]]);
    expect(ids(await k.get("/v1/transfers", { transfer_group: "g1" }))).toStrictEqual([
      t1.json["id"],
    ]);
    expect(
      ids(await k.get("/v1/transfers", { destination: a, created: { gte: t3.json["created"] } })),
    ).toStrictEqual([t3.json["id"]]);
    expect(
      ids(await k.get("/v1/transfers", { destination: a, created: { lt: t3.json["created"] } })),
    ).toStrictEqual([t1.json["id"]]);
    const page = await k.get("/v1/transfers", { destination: a, limit: 1 });
    expect(page.json["has_more"]).toBe(true);
    expect(
      ids(
        await k.get("/v1/transfers", { destination: a, limit: 1, starting_after: t3.json["id"] }),
      ),
    ).toStrictEqual([t1.json["id"]]);
  });
});
