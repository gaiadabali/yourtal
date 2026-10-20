import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { ZodValidationPipe } from "nestjs-zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPaymentProviders } from "@yourtal/drivers/payment-providers";
import { signStripePayload } from "@yourtal/drivers/stripe/signature";
import { createBrowser } from "@yourtal/paysim/browser";
import type { PaySimBrowser } from "@yourtal/paysim/browser";
import { startPaySimServer } from "@yourtal/paysim/server";
import type { PaySimServer } from "@yourtal/paysim/server";
import { AppModule } from "../../app.module";
import { PAYMENT_PROVIDERS } from "../../shared/drivers/payment-providers.module";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { sessionFor } from "../../shared/testing/session-for";
import { seedBusinessMembership } from "../../shared/testing/seed-business-membership";

/**
 * 5.1.a end to end with the real pieces: the payment simulation in-process,
 * the Stripe driver (the live AU providers, pointed at it), and the API's own
 * webhook route over real HTTP, with real Postgres and Cerbos. A purchase is
 * paid on the simulation's checkout page and granted only when its webhook
 * lands, exactly once.
 */
const CARD = { expiry: "12 / 34", cvc: "123" };
const OK = { number: "4242 4242 4242 4242", ...CARD };
const DECLINED = { number: "4000 0000 0000 0002", ...CARD };
const THREE_DS = { number: "4000 0025 0000 3155", ...CARD };

let app: NestFastifyApplication;
let paysim: PaySimServer;
let browser: PaySimBrowser;
let webhookUrl: string;
const db = createAppDb(process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!);
const deliveries: { body: string }[] = [];

beforeAll(async () => {
  // Records each webhook body the simulation sends, so a test can replay one.
  const recording: typeof fetch = (input, init) => {
    if (typeof init?.body === "string") deliveries.push({ body: init.body });
    return fetch(input, init);
  };
  paysim = await startPaySimServer({ fetch: recording });
  browser = createBrowser(paysim.baseUrl);
  // Only the payment providers go live: the rest of the app keeps its simulated drivers.
  const providers = createPaymentProviders({
    PAYMENTS_DRIVER: "live",
    STRIPE_SECRET_KEY: paysim.secretKey,
    STRIPE_WEBHOOK_SECRET: paysim.webhookSecret,
    STRIPE_API_BASE: paysim.baseUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PAYMENT_PROVIDERS)
    .useValue(providers)
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    rawBody: true,
  });
  app.useGlobalPipes(new ZodValidationPipe());
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address() as AddressInfo;
  webhookUrl = `http://127.0.0.1:${String(address.port)}/api/webhooks/stripe`;
  paysim.config.webhookUrl = webhookUrl;
});

afterAll(async () => {
  await app.close();
  await paysim.close();
});

async function owner() {
  const session = await sessionFor(app, { jurisdiction: "AU" });
  const businessId = await seedBusinessMembership(db, { userId: session.userId, role: "owner" });
  return { cookie: session.cookie, businessId };
}

async function buy(who: { cookie: string; businessId: string }) {
  const response = await app.inject({
    method: "POST",
    url: `/api/${who.businessId}/studio/billing/purchases`,
    headers: { cookie: who.cookie, "idempotency-key": `e2e-${randomUUID()}` },
    payload: { points: 1_000, currency: "AUD" },
  });
  expect(response.statusCode).toBe(201);
  const body = response.json<{
    status: string;
    purchaseId: string;
    checkoutUrl: string;
    purchase: { totalMinor: number };
  }>();
  expect(body.status).toBe("awaiting_payment");
  const sessionId = body.checkoutUrl.split("/checkout/")[1] ?? "";
  return { ...body, sessionId };
}

async function status(who: { cookie: string; businessId: string }, purchaseId: string) {
  const response = await app.inject({
    method: "GET",
    url: `/api/${who.businessId}/studio/billing/purchases/${purchaseId}`,
    headers: { cookie: who.cookie },
  });
  return response.json<{ status: string; allocationId: string | null }>();
}

async function allocations(businessId: string): Promise<number> {
  const { rows } = await db.execute(
    sql`SELECT count(*)::int AS n FROM platform.ledger_fake_allocation WHERE business_id = ${businessId}`,
  );
  return Number(rows[0]?.["n"]);
}

function post(body: string, signature: string) {
  return fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8", "stripe-signature": signature },
    body,
  });
}
const signed = (body: string) =>
  signStripePayload(body, paysim.webhookSecret, Math.floor(Date.now() / 1000));

describe("Stripe card purchases through the simulation (5.1.a)", () => {
  it("4242 pays, the webhook grants once, and a replayed delivery grants nothing more", async () => {
    const who = await owner();
    const purchase = await buy(who);
    expect(purchase.checkoutUrl.startsWith(`${paysim.baseUrl}/checkout/`)).toBe(true);
    expect(await allocations(who.businessId)).toBe(0);

    const page = await browser.submitCheckout(purchase.sessionId, OK);
    expect(page.status).toBe(303);
    expect(page.location).toContain(`purchase=${purchase.purchaseId}`);
    expect((await status(who, purchase.purchaseId)).status).toBe("pending");

    await paysim.tick();
    const paid = await status(who, purchase.purchaseId);
    expect(paid.status).toBe("paid");
    expect(paid.allocationId).not.toBeNull();
    expect(await allocations(who.businessId)).toBe(1);

    const completed = deliveries.find(
      (d) => d.body.includes("checkout.session.completed") && d.body.includes(purchase.purchaseId),
    );
    expect(completed).toBeDefined();
    const replay = await post(completed?.body ?? "", signed(completed?.body ?? ""));
    expect(replay.status).toBe(200);
    expect(await allocations(who.businessId)).toBe(1);
  });

  it("0002 is declined on the page and leaves the purchase pending", async () => {
    const who = await owner();
    const purchase = await buy(who);
    const page = await browser.submitCheckout(purchase.sessionId, DECLINED);
    expect(page.html).toContain("Your card was declined.");
    await paysim.tick();
    expect((await status(who, purchase.purchaseId)).status).toBe("pending");
    expect(await allocations(who.businessId)).toBe(0);
  });

  it("3155 asks for 3-D Secure, and completing it pays", async () => {
    const who = await owner();
    const purchase = await buy(who);
    const challenge = await browser.submitCheckout(purchase.sessionId, THREE_DS);
    expect(challenge.location).toBe(`/checkout/${purchase.sessionId}/3ds`);
    await paysim.tick();
    expect((await status(who, purchase.purchaseId)).status).toBe("pending");
    const done = await browser.decideThreeDS(purchase.sessionId, "complete");
    expect(done.status).toBe(303);
    await paysim.tick();
    expect((await status(who, purchase.purchaseId)).status).toBe("paid");
    expect(await allocations(who.businessId)).toBe(1);
  });

  it("an expired checkout marks the purchase expired", async () => {
    const who = await owner();
    const purchase = await buy(who);
    const expired = await fetch(
      `${paysim.baseUrl}/v1/checkout/sessions/${purchase.sessionId}/expire`,
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
    expect(expired.status).toBe(200);
    await paysim.tick();
    expect((await status(who, purchase.purchaseId)).status).toBe("expired");
  });
});

describe("POST /api/webhooks/stripe", () => {
  it("answers 400 to a bad signature and 200 to a type the app does not act on", async () => {
    const body = JSON.stringify({
      id: `evt_${randomUUID().replace(/-/g, "")}`,
      object: "event",
      type: "transfer.created",
      data: { object: { id: "tr_1", object: "transfer" } },
    });
    expect(
      (await post(body, signStripePayload(body, "whsec_not_ours", Math.floor(Date.now() / 1000))))
        .status,
    ).toBe(400);
    expect((await post("not json", signed("not json"))).status).toBe(400);
    expect((await post(body, signed(body))).status).toBe(200);
    expect((await post(body, signed(body))).status).toBe(200);
  });
});

describe("the card for boosts", () => {
  it("is required before a boost, and is saved through the simulation's page and webhook", async () => {
    const who = await owner();
    const campaignId = randomUUID();
    await db.execute(sql`
      INSERT INTO campaign.campaigns
        (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds, reward_points,
         question_count, scoring_rule, lifecycle_state, published_at, business_id, region, audience,
         content_category, poster_url, teaser_url, hls_url, aspect, estimated_bytes, estimated_data_mb,
         starts_at, ends_at, open_viewing, teaser_start_seconds)
      VALUES (${campaignId}, 'quick', 'Card e2e', ${who.businessId}, 'Card e2e', 'x', 30, 3, 0,
              'base_only', 'live', now(), ${who.businessId}, 'AU', 'all_ages', 'food-and-drink',
              'https://cdn.example.com/p.jpg', 'https://cdn.example.com/t.mp4',
              'https://cdn.example.com/m.m3u8', '9:16', 1000000, 10,
              now() - interval '1 day', now() + interval '30 days', false, 0)`);
    const boost = () =>
      app.inject({
        method: "PUT",
        url: `/api/${who.businessId}/studio/campaigns/${campaignId}/boost`,
        headers: { cookie: who.cookie },
        payload: {
          dailyBudgetMinor: 2_000,
          maxBidCpmMinor: 300,
          startsAt: new Date().toISOString(),
          endsAt: new Date(Date.now() + 86_400_000).toISOString(),
        },
      });

    const refused = await boost();
    expect(refused.statusCode).toBe(402);
    expect(refused.json<{ code: string }>().code).toBe("card_required");

    const started = await app.inject({
      method: "POST",
      url: `/api/${who.businessId}/studio/billing/card`,
      headers: { cookie: who.cookie },
    });
    expect(started.statusCode).toBe(201);
    const { checkoutUrl } = started.json<{ checkoutUrl: string }>();
    const sessionId = checkoutUrl.split("/checkout/")[1] ?? "";
    const page = await browser.submitCheckout(sessionId, OK);
    expect(page.location).toContain("card=saved");
    await paysim.tick();

    const card = await app.inject({
      method: "GET",
      url: `/api/${who.businessId}/studio/billing/card`,
      headers: { cookie: who.cookie },
    });
    expect(card.json()).toEqual({
      card: { brand: "visa", last4: "4242", expMonth: 12, expYear: 2034 },
      required: true,
    });
    const allowed = await boost();
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json<{ cardRequired: boolean }>().cardRequired).toBe(false);
  });
});
