import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import { ZodValidationPipe } from "nestjs-zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ParkedPurchases } from "@yourtal/contracts/staff/parked-purchases";
import { createPaymentProviders } from "@yourtal/drivers/payment-providers";
import { signStripePayload } from "@yourtal/drivers/stripe/signature";
import { createBrowser } from "@yourtal/paysim/browser";
import type { PaySimBrowser } from "@yourtal/paysim/browser";
import { startPaySimServer } from "@yourtal/paysim/server";
import type { PaySimServer } from "@yourtal/paysim/server";
import { AppModule } from "../../../app.module";
import { PAYMENT_PROVIDERS } from "../../../shared/drivers/payment-providers.module";
import { createAppDb } from "../../../shared/persistence/drizzle-client";
import { sessionFor } from "../../../shared/testing/session-for";
import { seedBusinessMembership } from "../../../shared/testing/seed-business-membership";
import { grantStaffRole, ownerPool } from "../staff.test-helper";
import { refundKey } from "./parked-purchases.service";

/**
 * 5.1.g (F123) end to end with the real pieces: the payment simulation
 * in-process, the Stripe driver pointed at it, the API's own webhook route,
 * real Postgres and Cerbos. A paid purchase the ledger would not turn into
 * points is parked, then refunded in full by a second staff member's approval,
 * exactly once, however the approval, the webhook and replays interleave.
 */
const OK = { number: "4242 4242 4242 4242", expiry: "12 / 34", cvc: "123" };

let app: NestFastifyApplication;
let paysim: PaySimServer;
let browser: PaySimBrowser;
let webhookUrl: string;
let owner: Pool;
let providers: ReturnType<typeof createPaymentProviders>;
const db = createAppDb(process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!);
const deliveries: { body: string }[] = [];

beforeAll(async () => {
  const recording: typeof fetch = (input, init) => {
    if (typeof init?.body === "string") deliveries.push({ body: init.body });
    return fetch(input, init);
  };
  paysim = await startPaySimServer({ fetch: recording });
  browser = createBrowser(paysim.baseUrl);
  providers = createPaymentProviders({
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
  owner = ownerPool();
  [A, B, OPS, buyer] = [
    await staff("finance"),
    await staff("finance"),
    await staff("ops"),
    await sessionFor(app, { jurisdiction: "AU" }),
  ];
});

afterAll(async () => {
  await owner.end();
  await app.close();
  await paysim.close();
});

// Sessions are made once: registering is rate limited route-wide, and the whole suite shares that budget.
type Session = Awaited<ReturnType<typeof sessionFor>>;
let A: Session;
let B: Session;
let OPS: Session;
let buyer: Session;

async function staff(role: "finance" | "ops") {
  const session = await sessionFor(app, { jurisdiction: "AU" });
  await grantStaffRole(owner, session.userId, role);
  return session;
}

/** A card purchase paid on the checkout page, whose total no longer matches what was paid, so the webhook parks it. */
async function parkedPurchase() {
  const session = buyer;
  const businessId = await seedBusinessMembership(db, { userId: session.userId, role: "owner" });
  const started = await app.inject({
    method: "POST",
    url: `/api/${businessId}/studio/billing/purchases`,
    headers: { cookie: session.cookie, "idempotency-key": `e2e-${randomUUID()}` },
    payload: { tierKey: "starter", currency: "AUD" },
  });
  expect(started.statusCode).toBe(201);
  const body = started.json<{ purchaseId: string; checkoutUrl: string }>();
  await owner.query(
    `UPDATE payment.card_purchase SET tax_minor = tax_minor + 1, total_minor = total_minor + 1
      WHERE id = $1`,
    [body.purchaseId],
  );
  const checkout = body.checkoutUrl.split("/checkout/")[1] ?? "";
  expect((await browser.submitCheckout(checkout, OK)).status).toBe(303);
  await paysim.tick();
  const row = await purchase(body.purchaseId);
  expect(row["status"]).toBe("needs_review");
  return { ...body, businessId, cookie: session.cookie };
}

async function purchase(id: string): Promise<Record<string, unknown>> {
  const { rows } = await owner.query(`SELECT * FROM payment.card_purchase WHERE id = $1`, [id]);
  return rows[0] as Record<string, unknown>;
}

const refundsAtProcessor = async () => (await paysim.store.listObjects("refund")).length;

const headers = (cookie: string) => ({ cookie, "idempotency-key": randomUUID() });

function propose(cookie: string, purchaseId: string, region = "AU") {
  return app.inject({
    method: "POST",
    url: `/api/staff/economy/${region}/parked-purchases/${purchaseId}/refund-proposals`,
    headers: headers(cookie),
    payload: { reason: "the rate rose while the checkout was open" },
  });
}

function decide(cookie: string, proposalId: string, verb: "approve" | "reject", region = "AU") {
  return app.inject({
    method: "POST",
    url: `/api/staff/economy/${region}/refund-proposals/${proposalId}/${verb}`,
    headers: headers(cookie),
    payload: {},
  });
}

const queue = async (cookie: string) =>
  (
    await app.inject({
      method: "GET",
      url: "/api/staff/economy/AU/parked-purchases",
      headers: { cookie },
    })
  ).json<ParkedPurchases>();

describe("parked purchases and their refund (5.1.g)", () => {
  it("lists a parked purchase for finance only, with business, amounts, reason and when paid", async () => {
    const parked = await parkedPurchase();
    const finance = A;
    const listed = await queue(finance.cookie);
    const row = listed.purchases.find((p) => p.purchaseId === parked.purchaseId);
    expect(row).toMatchObject({
      businessId: parked.businessId,
      businessName: "1.5.a Test Business Pty Ltd",
      region: "AU",
      currency: "AUD",
      status: "needs_review",
      points: 1_000,
      refundable: true,
      proposal: null,
      refundedAt: null,
    });
    expect(row?.reason).toMatch(/^paid 4950 AUD, expected 4951 AUD$/);
    expect(row?.paidAt).not.toBeNull();

    const ops = OPS;
    const refused = await app.inject({
      method: "GET",
      url: "/api/staff/economy/AU/parked-purchases",
      headers: { cookie: ops.cookie },
    });
    expect(refused.statusCode).toBe(403);
  });

  it("refunds the card in full once a second finance person approves, and only once", async () => {
    const parked = await parkedPurchase();
    const [a, b] = [A, B];

    const proposed = await propose(a.cookie, parked.purchaseId);
    expect(proposed.statusCode).toBe(201);
    const proposal = proposed.json<{ id: string; status: string; kind: string }>();
    expect(proposal).toMatchObject({ status: "pending", kind: "refund_purchase" });
    // Nothing moved at the proposal.
    expect(await purchase(parked.purchaseId)).toMatchObject({
      status: "needs_review",
      refund_proposal_id: null,
    });
    expect((await propose(b.cookie, parked.purchaseId)).statusCode).toBe(409);
    expect(
      (await queue(b.cookie)).purchases.find((p) => p.purchaseId === parked.purchaseId),
    ).toMatchObject({ proposal: { id: proposal.id, proposedBy: a.userId } });

    const before = await refundsAtProcessor();
    expect((await decide(a.cookie, proposal.id, "approve")).statusCode).toBe(403);
    expect(await refundsAtProcessor()).toBe(before);

    const approved = await decide(b.cookie, proposal.id, "approve");
    expect(approved.statusCode).toBe(201);
    expect(approved.json<{ status: string; approvedBy: string }>()).toMatchObject({
      status: "approved",
      approvedBy: b.userId,
    });
    expect(await refundsAtProcessor()).toBe(before + 1);
    const refunded = await purchase(parked.purchaseId);
    expect(refunded).toMatchObject({
      status: "refunded",
      refund_requested_by: b.userId,
      refund_proposal_id: proposal.id,
    });
    expect(String(refunded["refund_ref"])).toMatch(/^re_/);
    expect(refunded["refunded_at"]).not.toBeNull();
    // The whole payment went back: what was paid (A$49.50), not what the purchase expected.
    const refund = (await paysim.store.listObjects("refund")).find(
      (r) => r.id === refunded["refund_ref"],
    );
    expect(refund?.data["amount"]).toBe(4_950);

    // The processor's own refund webhook, and a replay of it, change nothing.
    await paysim.tick();
    const event = deliveries.find(
      (d) => d.body.includes("refund.created") && d.body.includes(String(refunded["refund_ref"])),
    );
    expect(event).toBeDefined();
    const body = event?.body ?? "";
    const signature = signStripePayload(body, paysim.webhookSecret, Math.floor(Date.now() / 1000));
    const replay = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8", "stripe-signature": signature },
      body,
    });
    expect(replay.status).toBe(200);
    expect(await purchase(parked.purchaseId)).toMatchObject({
      status: "refunded",
      refund_ref: refunded["refund_ref"],
    });

    // The business sees "refunded", no points were ever granted, and nothing can refund it again.
    const status = await app.inject({
      method: "GET",
      url: `/api/${parked.businessId}/studio/billing/purchases/${parked.purchaseId}`,
      headers: { cookie: parked.cookie },
    });
    expect(status.json<{ status: string }>().status).toBe("refunded");
    const { rows: grants } = await owner.query(
      `SELECT count(*)::int AS n FROM platform.ledger_fake_allocation WHERE business_id = $1`,
      [parked.businessId],
    );
    expect(grants[0]).toMatchObject({ n: 0 });
    expect((await decide(b.cookie, proposal.id, "approve")).statusCode).toBe(400);
    expect((await propose(a.cookie, parked.purchaseId)).statusCode).toBe(409);
    expect(await refundsAtProcessor()).toBe(before + 1);

    // It leaves the queue's parked list and shows as refunded, by whom and when.
    const after = (await queue(a.cookie)).purchases.find((p) => p.purchaseId === parked.purchaseId);
    expect(after).toMatchObject({ status: "refunded", refundedBy: b.userId });
  });

  it("finishes an approval after the processor already refunded it under the same key, without refunding twice", async () => {
    const parked = await parkedPurchase();
    const [a, b] = [A, B];
    const proposal = (await propose(a.cookie, parked.purchaseId)).json<{ id: string }>();
    const row = await purchase(parked.purchaseId);

    // A crash after the processor took the refund: the claim is written, the purchase not yet marked.
    await owner.query(
      `UPDATE payment.card_purchase SET refund_proposal_id = $2, refund_requested_by = $3 WHERE id = $1`,
      [parked.purchaseId, proposal.id, b.userId],
    );
    const before = await refundsAtProcessor();
    const sent = await providers.AU.payments.refund({
      idempotencyKey: refundKey(parked.purchaseId),
      paymentReference: String(row["payment_ref"]),
      currency: "AUD",
      reference: `card-purchase:${parked.purchaseId}`,
    });
    expect(sent.isOk()).toBe(true);
    expect(await refundsAtProcessor()).toBe(before + 1);

    // The refund webhook alone settles a claimed purchase.
    await paysim.tick();
    expect(await purchase(parked.purchaseId)).toMatchObject({ status: "refunded" });

    // Approving now closes the proposal; the processor is not asked again.
    const approved = await decide(b.cookie, proposal.id, "approve");
    expect(approved.statusCode).toBe(201);
    expect(await refundsAtProcessor()).toBe(before + 1);
  });

  it("a refund staff did not ask for leaves the purchase parked, and approving then is refused by the processor and frees it", async () => {
    const parked = await parkedPurchase();
    const [a, b] = [A, B];
    const row = await purchase(parked.purchaseId);
    const proposal = (await propose(a.cookie, parked.purchaseId)).json<{ id: string }>();

    // Refunded in the processor's dashboard: not ours to record.
    (
      await providers.AU.payments.refund({
        idempotencyKey: `dashboard-${randomUUID()}`,
        paymentReference: String(row["payment_ref"]),
        currency: "AUD",
        reference: "dashboard",
      })
    )._unsafeUnwrap();
    await paysim.tick();
    expect(await purchase(parked.purchaseId)).toMatchObject({ status: "needs_review" });

    const refused = await decide(b.cookie, proposal.id, "approve");
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ code: string }>().code).toBe("refund_refused");
    // Nothing was refunded by us, so the claim is freed and the proposal stays open to be rejected.
    expect(await purchase(parked.purchaseId)).toMatchObject({
      status: "needs_review",
      refund_proposal_id: null,
    });
    expect((await decide(b.cookie, proposal.id, "reject")).statusCode).toBe(201);
  });

  it("a proposal can be declined, by its proposer too, and the purchase can then be proposed again", async () => {
    const parked = await parkedPurchase();
    const [a, b] = [A, B];
    const first = (await propose(a.cookie, parked.purchaseId)).json<{ id: string }>();
    const rejected = await decide(a.cookie, first.id, "reject");
    expect(rejected.statusCode).toBe(201);
    expect(rejected.json<{ status: string }>().status).toBe("rejected");
    expect((await decide(b.cookie, first.id, "approve")).statusCode).toBe(400);
    expect((await propose(b.cookie, parked.purchaseId)).statusCode).toBe(201);
  });

  it("refuses a purchase that is not parked, is in another region, or has no payment to refund", async () => {
    const a = A;
    expect((await propose(a.cookie, randomUUID())).statusCode).toBe(404);
    const parked = await parkedPurchase();
    expect((await propose(a.cookie, parked.purchaseId, "ID")).statusCode).toBe(404);
    await owner.query(`UPDATE payment.card_purchase SET payment_ref = NULL WHERE id = $1`, [
      parked.purchaseId,
    ]);
    const refused = await propose(a.cookie, parked.purchaseId);
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ code: string }>().code).toBe("not_refundable");
    expect(
      (await queue(a.cookie)).purchases.find((p) => p.purchaseId === parked.purchaseId)?.refundable,
    ).toBe(false);
  });

  it("requires a reason, and finance", async () => {
    const parked = await parkedPurchase();
    const [a, ops] = [A, OPS];
    const noReason = await app.inject({
      method: "POST",
      url: `/api/staff/economy/AU/parked-purchases/${parked.purchaseId}/refund-proposals`,
      headers: headers(a.cookie),
      payload: {},
    });
    expect(noReason.statusCode).toBe(400);
    expect((await propose(ops.cookie, parked.purchaseId)).statusCode).toBe(403);
  });

  it("Indonesia refunds through its simulated driver, which settles at once", async () => {
    const [a, b] = [A, B];
    const id = randomUUID();
    await owner.query(
      `INSERT INTO payment.card_purchase
         (id, business_id, region, currency, points, subtotal_minor, tax_minor, total_minor,
          tax_rate_bps, idempotency_key, provider, checkout_expires_at, status, payment_ref,
          review_reason, paid_at)
       VALUES ($1, $2, 'ID', 'IDR', 1000, 9000, 0, 9000, 0, $3, 'simulated', now(), 'needs_review',
               'simcs_x', 'the ledger refused the points: refused: below the issue price', now())`,
      [id, randomUUID(), `id-${id}`],
    );
    const proposed = await propose(a.cookie, id, "ID");
    expect(proposed.statusCode).toBe(201);
    const approved = await decide(b.cookie, proposed.json<{ id: string }>().id, "approve", "ID");
    expect(approved.statusCode).toBe(201);
    expect(await purchase(id)).toMatchObject({
      status: "refunded",
      refund_ref: expect.stringMatching(/^simre_/),
    });
  });
});
