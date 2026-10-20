import { createHash, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { ZodValidationPipe } from "nestjs-zod";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DemoApi } from "@yourtal/db/demo-world/api-client";
import { ensureBidderCard } from "@yourtal/db/demo-world/card";
import { createPaymentProviders } from "@yourtal/drivers/payment-providers";
import { signStripePayload } from "@yourtal/drivers/stripe/signature";
import { createBrowser } from "@yourtal/paysim/browser";
import type { PaySimBrowser } from "@yourtal/paysim/browser";
import { startPaySimServer } from "@yourtal/paysim/server";
import type { PaySimServer } from "@yourtal/paysim/server";
import { AppModule } from "../../app.module";
import { sessionFor } from "../../shared/testing/session-for";
import type { TestSession } from "../../shared/testing/session-for";

/**
 * 5.1.d end to end with the real pieces: the payment simulation in-process, the Stripe driver (the
 * live AU providers, built from the environment as production would), the API over real HTTP with
 * real Postgres and Cerbos, and the simulation's webhooks delivered to the API's own route. A
 * charity is onboarded through the simulation, two bidders save cards on its checkout page and bid,
 * the earlier hold is released, and settlement captures the winner straight into the charity's own
 * balance and releases the loser. YourTal never holds the money (red line 8, F86).
 */
const CARD = { number: "4242 4242 4242 4242", expiry: "12 / 34", cvc: "123" };
const ENV_KEYS = [
  "PAYMENTS_DRIVER",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_API_BASE",
] as const;
const DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!;

let app: NestFastifyApplication;
let paysim: PaySimServer;
let browser: PaySimBrowser;
let pool: pg.Pool;
/** Moves the simulation's clock on, for Stripe's 7-day sweep of an uncaptured hold. */
let skewMs = 0;
let apiBase = "";
/** Every webhook body the simulation sent, so one can be replayed with a fresh signature. */
const deliveries: string[] = [];
const savedEnv = new Map<string, string | undefined>();
let connect: ReturnType<typeof createPaymentProviders>["AU"]["payoutAccounts"];

beforeAll(async () => {
  const recording: typeof fetch = (input, init) => {
    if (typeof init?.body === "string") deliveries.push(init.body);
    return fetch(input, init);
  };
  paysim = await startPaySimServer({ now: () => new Date(Date.now() + skewMs), fetch: recording });
  browser = createBrowser(paysim.baseUrl);
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
  process.env["PAYMENTS_DRIVER"] = "live";
  process.env["STRIPE_SECRET_KEY"] = paysim.secretKey;
  process.env["STRIPE_WEBHOOK_SECRET"] = paysim.webhookSecret;
  process.env["STRIPE_API_BASE"] = paysim.baseUrl;
  // A second set of drivers, only to onboard charities the way the payouts work will.
  connect = createPaymentProviders({
    PAYMENTS_DRIVER: "live",
    DISBURSEMENT_DRIVER: "live",
    STRIPE_SECRET_KEY: paysim.secretKey,
    STRIPE_WEBHOOK_SECRET: paysim.webhookSecret,
    STRIPE_API_BASE: paysim.baseUrl,
  }).AU.payoutAccounts;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    rawBody: true,
  });
  app.useGlobalPipes(new ZodValidationPipe());
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as AddressInfo;
  apiBase = `http://127.0.0.1:${String(port)}`;
  paysim.config.webhookUrl = `${apiBase}/api/webhooks/stripe`;
  pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
});

afterAll(async () => {
  await app.close();
  await paysim.close();
  await pool.end();
  for (const key of ENV_KEYS) {
    const before = savedEnv.get(key);
    if (before === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = before;
  }
});

async function adult(): Promise<TestSession> {
  const session = await sessionFor(app, { jurisdiction: "AU" });
  await pool.query(`UPDATE identity.credential SET verified_at = now() WHERE user_id = $1`, [
    session.userId,
  ]);
  return session;
}

/** A connected account onboarded on the simulation's page, as a charity finishing Connect onboarding would be. */
async function onboardedCharityAccount(): Promise<string> {
  const key = randomUUID().slice(0, 8);
  const created = await connect.createAccount({
    idempotencyKey: `account:${key}`,
    reference: `charity:${key}`,
    kind: "charity",
    email: `${key}@example.test`,
    payoutSchedule: "manual",
  });
  const { accountRef } = created._unsafeUnwrap();
  const link = (
    await connect.onboardingLink({
      accountRef,
      returnUrl: "https://app.test/payouts/done",
      refreshUrl: "https://app.test/payouts/again",
      purpose: "onboarding",
    })
  )._unsafeUnwrap();
  const token = new URL(link.url).pathname.split("/").pop() ?? "";
  const page = await browser.completeOnboarding(token, { bsb: "110000", account: "000123456" });
  expect(page.status).toBe(303);
  return accountRef;
}

/** An approved AU charity whose payout reference is the given one (the onboarding stores the `acct_`). */
async function charity(payoutReference: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO charity.charity (id, region, name, cause, summary, registration,
       payout_account_name, payout_account_last4, kyb_reference, payout_reference, state,
       applied_by, decided_by, decided_at)
     VALUES ($1, 'AU', 'Coastal Kids Trust', 'children_youth', 'e2e', $2, 'Coastal Kids Trust',
             '3456', 'simkyb', $3, 'approved', $4, 'staff', now())`,
    [
      id,
      JSON.stringify({ kind: "au_acnc", abn: "51824753524", acncRegistered: true }),
      payoutReference,
      randomUUID(),
    ],
  );
  await pool.query(`INSERT INTO charity.member (charity_id, user_id) VALUES ($1, $2)`, [
    id,
    randomUUID(),
  ]);
  return id;
}

async function voucherFor(ownerId: string): Promise<string> {
  const listingId = randomUUID();
  await pool.query(
    `INSERT INTO store.listings (id, merchant_id, merchant_name, title, description, category,
       face_value_minor, settlement_value_minor, price_in_points, stock_remaining, stock_total,
       transferable, partial_redemption_policy, minimum_spend_minor, expires_at, status, currency,
       region, audience, content_category, image_url, channel, partial_redemption)
     VALUES ($1, $2, 'Kopi', 'Kopi voucher', 'e2e', 'food_beverage', 5000, 1500, 100, 10, 10,
       true, 'single_use_forfeit', NULL, now() + interval '90 days', 'available', 'AUD', 'AU',
       'all_ages', 'food-and-drink', 'http://127.0.0.1:26900/p.jpg', 'both', 'single_use')`,
    [listingId, randomUUID()],
  );
  const voucherId = randomUUID();
  const code = randomUUID().replace(/-/g, "").slice(0, 16);
  await pool.query(
    `INSERT INTO platform.voucher_fake_voucher
       (id, listing_id, saga_id, owner_id, code, code_hash, state, remaining_value_minor, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'activated', 5000, now() + interval '90 days')`,
    [
      voucherId,
      listingId,
      randomUUID(),
      ownerId,
      code,
      createHash("sha256").update(code).digest("hex"),
    ],
  );
  return voucherId;
}

const call = (
  method: "GET" | "POST",
  url: string,
  who: TestSession,
  payload?: object,
): ReturnType<typeof app.inject> =>
  app.inject({
    method,
    url,
    headers: {
      cookie: who.cookie,
      ...(method === "POST" && url.includes("/bids") ? { "idempotency-key": randomUUID() } : {}),
      ...(method === "POST" && url.includes("/auction") && !url.includes("/bids")
        ? { "idempotency-key": randomUUID() }
        : {}),
    },
    ...(payload === undefined ? {} : { payload }),
  });

async function listed(seller: TestSession, charityId: string): Promise<string> {
  const voucherId = await voucherFor(seller.userId);
  const response = await call("POST", `/api/wallet/vouchers/${voucherId}/auction`, seller, {
    charityId,
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ auctionId: string }>().auctionId;
}

/** Opens the card page from the API, pays on the simulation's page with 4242, and waits for the webhook. */
async function saveCard(who: TestSession, auctionId: string): Promise<void> {
  const started = await call("POST", "/api/me/payment-card", who, { auctionId });
  expect(started.statusCode, started.body).toBe(201);
  const { checkoutUrl } = started.json<{ checkoutUrl: string }>();
  expect(checkoutUrl.startsWith(`${paysim.baseUrl}/checkout/`)).toBe(true);
  const page = await browser.submitCheckout(checkoutUrl.split("/checkout/")[1] ?? "", CARD);
  expect(page.status).toBe(303);
  expect(page.location).toContain(`/auctions/${auctionId}?card=saved`);
  await paysim.tick();
  const card = await call("GET", "/api/me/payment-card", who);
  expect(card.json()).toMatchObject({ card: { brand: "visa", last4: "4242" }, required: true });
}

const bid = (who: TestSession, auctionId: string, amountMinor: number) =>
  call("POST", `/api/auctions/${auctionId}/bids`, who, { amountMinor });

interface BidRow {
  readonly bidder_id: string;
  readonly amount_minor: string;
  readonly hold_reference: string;
  readonly state: string;
}
async function bids(auctionId: string): Promise<BidRow[]> {
  const { rows } = await pool.query<BidRow>(
    `SELECT bidder_id, amount_minor, hold_reference, state FROM auction.bid
      WHERE auction_id = $1 ORDER BY amount_minor`,
    [auctionId],
  );
  return rows;
}

async function stripeGet(path: string, account?: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${paysim.baseUrl}${path}`, {
    headers: {
      authorization: `Bearer ${paysim.secretKey}`,
      ...(account === undefined ? {} : { "stripe-account": account }),
    },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

const intent = (id: string) => stripeGet(`/v1/payment_intents/${id}`);
async function available(account: string): Promise<number> {
  const balance = await stripeGet("/v1/balance", account);
  return (balance["available"] as { amount: number }[])[0]?.amount ?? 0;
}

const endAuction = (auctionId: string) =>
  pool.query(`UPDATE auction.auction SET ends_at = now() - interval '1 second' WHERE id = $1`, [
    auctionId,
  ]);

describe("the bidder's card (5.1.d)", () => {
  it("is for verified adults only, and is required in AU", async () => {
    const bidder = await adult();
    const card = await call("GET", "/api/me/payment-card", bidder);
    expect(card.statusCode, card.body).toBe(200);
    expect(card.json()).toEqual({ card: null, required: true });

    const teen = await adult();
    await pool.query(
      `UPDATE identity.user_profile SET date_of_birth = (now() - interval '15 years')::date,
              parent_consent_status = 'granted' WHERE user_id = $1`,
      [teen.userId],
    );
    expect((await call("GET", "/api/me/payment-card", teen)).statusCode).toBe(403);
    expect((await call("POST", "/api/me/payment-card", teen, {})).statusCode).toBe(403);

    // The card page returns to a path built from an id, never a URL a client names.
    const bad = await call("POST", "/api/me/payment-card", bidder, {
      auctionId: "https://evil.example/steal",
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe("the demo world's bidders (5.1.d)", () => {
  it("save a card through the real route and the simulation's checkout page", async () => {
    const bidder = await adult();
    const api = new DemoApi(apiBase).withSession(bidder.token);
    // The simulation delivers its webhooks on a timer when it runs for real; here, a fast one.
    const ticking = setInterval(() => void paysim.tick(), 300);
    try {
      expect(await ensureBidderCard(api, "a demo bidder")).toBe(true);
    } finally {
      clearInterval(ticking);
    }
    const card = await call("GET", "/api/me/payment-card", bidder);
    expect(card.json()).toMatchObject({ card: { brand: "visa", last4: "4242" }, required: true });
    // A second run finds the card and does nothing more.
    expect(await ensureBidderCard(api, "a demo bidder")).toBe(true);
  }, 60_000);
});

describe("account deletion (5.1.d)", () => {
  it("erases the bidder's customer, saved card and setup history, and no one else's", async () => {
    const [leaving, staying] = [await adult(), await adult()];
    await saveCard(leaving, randomUUID());
    await saveCard(staying, randomUUID());
    const count = async (userId: string): Promise<number[]> =>
      Promise.all(
        ["customer", "saved_card", "card_setup"].map(async (table) => {
          const { rows } = await pool.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM payment.${table} WHERE owner_kind = 'user' AND owner_id = $1`,
            [userId],
          );
          return rows[0]?.n ?? 0;
        }),
      );
    expect(await count(leaving.userId)).toEqual([1, 1, 1]);

    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/me",
      headers: { cookie: leaving.cookie, "idempotency-key": randomUUID() },
    });
    expect(deleted.statusCode, deleted.body).toBe(200);
    const report = deleted.json<{ results: { domain: string; outcome: { status: string } }[] }>();
    expect(report.results.find((r) => r.domain === "payment_cards")?.outcome.status).toBe("erased");
    expect(await count(leaving.userId)).toEqual([0, 0, 0]);
    expect(await count(staying.userId)).toEqual([1, 1, 1]);
  });
});

describe("a Stripe charity auction (5.1.d)", () => {
  it("is refused charity_not_ready when the charity has no connected account yet", async () => {
    const seller = await adult();
    const charityId = await charity(`simpayout_${randomUUID().slice(0, 8)}`);
    const voucherId = await voucherFor(seller.userId);
    const response = await call("POST", `/api/wallet/vouchers/${voucherId}/auction`, seller, {
      charityId,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "charity_not_ready" });
  });

  it("holds each bidder's card, releases the earlier hold, and captures the winner into the charity's own balance", async () => {
    const [seller, a, b] = [await adult(), await adult(), await adult()];
    const account = await onboardedCharityAccount();
    const auctionId = await listed(seller, await charity(account));

    // No card: refused, and nothing is held.
    const refused = await bid(a, auctionId, 2_500);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: "card_required" });
    expect(await bids(auctionId)).toEqual([]);

    await saveCard(a, auctionId);
    await saveCard(b, auctionId);

    expect((await bid(a, auctionId, 2_500)).statusCode).toBe(201);
    expect((await bid(b, auctionId, 3_000)).statusCode).toBe(201);
    const raised = await bid(a, auctionId, 3_500);
    expect(raised.statusCode, raised.body).toBe(201);
    expect(raised.json()).toMatchObject({
      bidCount: 3,
      currentAmountMinor: 3_500,
      viewer: { bidStatus: "leading" },
    });
    expect(JSON.stringify(raised.json())).not.toContain(a.userId);

    const [first, second, third] = await bids(auctionId);
    // The hold is on the bidder's card and pays the charity's account, with nothing captured yet.
    expect(await intent(second?.hold_reference ?? "")).toMatchObject({
      status: "requires_capture",
      amount: 3_000,
      transfer_data: { destination: account },
      on_behalf_of: account,
    });
    // A's earlier hold went when A raised the bid.
    expect(first?.state).toBe("released");
    expect(await intent(first?.hold_reference ?? "")).toMatchObject({ status: "canceled" });
    expect(await available(account)).toBe(0);

    await endAuction(auctionId);
    const closed = await call("GET", `/api/auctions/${auctionId}`, a);
    expect(closed.json()).toMatchObject({
      state: "ended",
      outcome: "sold",
      viewer: { bidStatus: "won" },
    });

    // The winner's 3,500 landed in the charity's own balance; the loser's hold is gone.
    expect(await intent(third?.hold_reference ?? "")).toMatchObject({
      status: "succeeded",
      amount_received: 3_500,
    });
    expect(await available(account)).toBe(3_500);
    expect(await intent(second?.hold_reference ?? "")).toMatchObject({ status: "canceled" });
    expect((await bids(auctionId)).map((row) => row.state)).toEqual([
      "released",
      "released",
      "captured",
    ]);
    const { rows } = await pool.query(
      `SELECT winner_id, amount_minor, destination_reference, capture_reference
         FROM auction.settlement WHERE auction_id = $1`,
      [auctionId],
    );
    expect(rows[0]).toMatchObject({
      winner_id: a.userId,
      amount_minor: "3500",
      destination_reference: account,
      capture_reference: third?.hold_reference,
    });
  });

  it("marks a hold released when its payment is cancelled, and settlement leaves it alone", async () => {
    const [seller, a] = [await adult(), await adult()];
    const account = await onboardedCharityAccount();
    const auctionId = await listed(seller, await charity(account));
    await saveCard(a, auctionId);
    expect((await bid(a, auctionId, 2_500)).statusCode).toBe(201);
    const [held] = await bids(auctionId);

    // The hold is cancelled outside the app (Stripe's sweep, or the bank): the webhook says so.
    const cancelled = await fetch(
      `${paysim.baseUrl}/v1/payment_intents/${held?.hold_reference}/cancel`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${paysim.secretKey}`,
          "idempotency-key": randomUUID(),
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "",
      },
    );
    expect(cancelled.status).toBe(200);
    await paysim.tick();
    expect((await bids(auctionId))[0]?.state).toBe("released");

    // Nothing is left to capture: the auction ends unsold, and no money moved.
    await endAuction(auctionId);
    const closed = await call("GET", `/api/auctions/${auctionId}`, seller);
    expect(closed.json()).toMatchObject({ state: "ended", outcome: "unsold" });
    expect(await available(account)).toBe(0);
  });

  it("marks a hold released when Stripe's 7-day sweep cancels it (reason automatic)", async () => {
    const [seller, a] = [await adult(), await adult()];
    const account = await onboardedCharityAccount();
    const auctionId = await listed(seller, await charity(account));
    await saveCard(a, auctionId);
    expect((await bid(a, auctionId, 2_500)).statusCode).toBe(201);
    const [held] = await bids(auctionId);
    expect(held?.state).toBe("held");

    // The simulation's clock runs a week ahead, so it signs its webhook a week from now and the
    // API refuses that timestamp. Replay the same event body, signed with the real time.
    skewMs = 7 * 24 * 60 * 60_000 + 60_000;
    await paysim.tick();
    expect(await intent(held?.hold_reference ?? "")).toMatchObject({ status: "canceled" });
    const event = deliveries.find(
      (body) =>
        body.includes("payment_intent.canceled") && body.includes(held?.hold_reference ?? "-"),
    );
    expect(event).toBeDefined();
    expect(JSON.parse(event ?? "{}")).toMatchObject({
      data: { object: { cancellation_reason: "automatic" } },
    });
    for (let delivery = 0; delivery < 2; delivery += 1) {
      const replay = await fetch(paysim.config.webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          "stripe-signature": signStripePayload(
            event ?? "",
            paysim.webhookSecret,
            Math.floor(Date.now() / 1000),
          ),
        },
        body: event ?? "",
      });
      expect(replay.status).toBe(200);
    }
    expect((await bids(auctionId))[0]?.state).toBe("released");
  });
});
