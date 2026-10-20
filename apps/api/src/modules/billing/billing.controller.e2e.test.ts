import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { sessionFor } from "../../shared/testing/session-for";
import { seedBusinessMembership } from "../../shared/testing/seed-business-membership";
import { FakeLedgerClient } from "../../shared/ledger-client/fake-ledger-client";
import { generateStatementFake } from "../../shared/ledger-client/fake/fake-ledger-economy";
import { toMinorUnits } from "@yourtal/contracts/money";

/**
 * 7.5.c's Check, over the real HTTP stack: a simulated purchase appears as
 * a ledger purchase with its allocation, and a replay does not charge
 * twice. Real Cerbos (`billing.yaml` already existed before 7.5 -- this
 * suite is not the thing that first introduces that policy file), real
 * Postgres, `LEDGER_MODE=fake` (this suite's default) plus the simulated
 * payments driver (also the default -- `PAYMENTS_DRIVER` is unset), which
 * settles a checkout at once. The Stripe path is stripe-purchase.e2e.test.ts.
 */
let app: NestFastifyApplication;
const db = createAppDb(process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!);

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

async function ownerAt(region: "AU" | "ID" = "AU") {
  const session = await sessionFor(app, { jurisdiction: region });
  const businessId = await seedBusinessMembership(db, {
    userId: session.userId,
    role: "owner",
    region,
  });
  return { cookie: session.cookie, businessId };
}

describe("POST /api/:tenantId/studio/billing/purchases", () => {
  it("funds an allocation, and a replay with the same Idempotency-Key does not charge twice", async () => {
    const { cookie, businessId } = await ownerAt();
    const idempotencyKey = `test-${randomUUID()}`;

    const first = await app.inject({
      method: "POST",
      url: `/api/${businessId}/studio/billing/purchases`,
      headers: { cookie, "idempotency-key": idempotencyKey },
      payload: { points: 1_000, currency: "AUD" },
    });
    expect(first.statusCode).toBe(201);
    const firstBody = first.json<{
      allocation: { remainingPoints: number; totalPoints: number };
    }>();
    expect(firstBody.allocation.totalPoints).toBe(1_000);
    expect(firstBody.allocation.remainingPoints).toBe(1_000);

    const balanceAfterFirst = await app.inject({
      method: "GET",
      url: `/api/${businessId}/studio/billing/balance`,
      headers: { cookie },
    });
    expect(balanceAfterFirst.json<{ totalPoints: number }>().totalPoints).toBe(1_000);

    const replay = await app.inject({
      method: "POST",
      url: `/api/${businessId}/studio/billing/purchases`,
      headers: { cookie, "idempotency-key": idempotencyKey },
      payload: { points: 1_000, currency: "AUD" },
    });
    expect(replay.statusCode).toBe(201);

    const balanceAfterReplay = await app.inject({
      method: "GET",
      url: `/api/${businessId}/studio/billing/balance`,
      headers: { cookie },
    });
    // THE invariant: the replay did not create a second allocation.
    expect(balanceAfterReplay.json<{ totalPoints: number }>().totalPoints).toBe(1_000);
  });

  it("an Indonesian business can buy points in IDR (whole Rupiah)", async () => {
    // The payments driver once had no declared IDR unit and declined every IDR charge.
    const { cookie, businessId } = await ownerAt("ID");

    const response = await app.inject({
      method: "POST",
      url: `/api/${businessId}/studio/billing/purchases`,
      headers: { cookie, "idempotency-key": `test-${randomUUID()}` },
      payload: { points: 1_000, currency: "IDR" },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json<{
      status: string;
      purchase: { currency: string; totalMinor: number; taxMinor: number; status: string };
      allocation: { totalPoints: number } | null;
    }>();
    // Indonesia stays on the simulated driver (F104): settled at once, no GST (F118).
    expect(body.status).toBe("paid");
    expect(body.purchase).toMatchObject({ currency: "IDR", taxMinor: 0, status: "paid" });
    expect(body.purchase.totalMinor).toBeGreaterThan(0);
    expect(body.allocation?.totalPoints).toBe(1_000);
  });

  it("records the GST split, and GET .../purchases/:id reads it back to its own business only", async () => {
    const { cookie, businessId } = await ownerAt();
    const response = await app.inject({
      method: "POST",
      url: `/api/${businessId}/studio/billing/purchases`,
      headers: { cookie, "idempotency-key": `test-${randomUUID()}` },
      payload: { points: 1_000, currency: "AUD" },
    });
    expect(response.statusCode).toBe(201);
    const { purchaseId, purchase } = response.json<{
      purchaseId: string;
      purchase: { subtotalMinor: number; taxMinor: number; totalMinor: number; taxRateBps: number };
    }>();
    expect(purchase.taxRateBps).toBe(1_000);
    expect(purchase.taxMinor).toBe(Math.floor((purchase.subtotalMinor * 1_000 + 5_000) / 10_000));
    expect(purchase.totalMinor).toBe(purchase.subtotalMinor + purchase.taxMinor);

    const read = await app.inject({
      method: "GET",
      url: `/api/${businessId}/studio/billing/purchases/${purchaseId}`,
      headers: { cookie },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json<{ status: string }>().status).toBe("paid");

    const stranger = await ownerAt();
    const stolen = await app.inject({
      method: "GET",
      url: `/api/${stranger.businessId}/studio/billing/purchases/${purchaseId}`,
      headers: { cookie: stranger.cookie },
    });
    expect(stolen.statusCode).toBe(404);
  });

  it("refuses a currency that does not match the business's own", async () => {
    const { cookie, businessId } = await ownerAt();

    const response = await app.inject({
      method: "POST",
      url: `/api/${businessId}/studio/billing/purchases`,
      headers: { cookie, "idempotency-key": `test-${randomUUID()}` },
      // This business is AU/AUD -- IDR is refused, never silently charged in AUD instead (7.5.a).
      payload: { points: 1_000, currency: "IDR" },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("GET /api/:tenantId/studio/billing/purchases/quote", () => {
  it("shows a pack price with no backing rate anywhere in the response", async () => {
    const { cookie, businessId } = await ownerAt();

    const response = await app.inject({
      method: "GET",
      url: `/api/${businessId}/studio/billing/purchases/quote?points=1000`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      subtotalMinor: number;
      taxMinor: number;
      totalMinor: number;
      taxRateBps: number;
      currency: string;
    }>();
    expect(body.currency).toBe("AUD");
    expect(body.subtotalMinor).toBeGreaterThan(0);
    // F118: AU prices are ex-GST; 10% GST goes on top.
    expect(body.taxRateBps).toBe(1_000);
    expect(body.totalMinor).toBe(body.subtotalMinor + body.taxMinor);
    expect(JSON.stringify(body)).not.toMatch(/micros|backingRate/i);
  });
});

describe("statements (10.1.b/10.6.b)", () => {
  it("GET .../statements lists what was generated, as JSON or CSV, and POST .../dispute holds the payout", async () => {
    const { cookie, businessId } = await ownerAt();
    const fake = new FakeLedgerClient(db);

    const captureId = randomUUID();
    (
      await fake.captureVoucher({
        captureId,
        region: "AU",
        merchantId: businessId,
        amountMinor: toMinorUnits(4_200),
        currency: "AUD",
      })
    )._unsafeUnwrap();

    const from = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const to = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const generated = await generateStatementFake(db, { businessId, region: "AU", from, to });
    expect(generated.capturesMinor).toBe(4_200);

    const list = await app.inject({
      method: "GET",
      url: `/api/${businessId}/studio/billing/statements?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      headers: { cookie },
    });
    expect(list.statusCode).toBe(200);
    const statements = list.json<{ id: string; capturesMinor: number; status: string }[]>();
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatchObject({ id: generated.id, capturesMinor: 4_200, status: "open" });

    const csv = await app.inject({
      method: "GET",
      url: `/api/${businessId}/studio/billing/statements?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&format=csv`,
      headers: { cookie },
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    expect(csv.body).toContain(generated.id);
    expect(csv.body.split("\r\n")[0]).toBe(
      "id,region,currency,periodFrom,periodTo,openingPayableMinor,capturesMinor,refundsMinor,recoveriesMinor,closingPayableMinor,pointPurchasesPoints,status,disputeWindowEndsAt,generatedAt,payoutTransferId",
    );

    const dispute = await app.inject({
      method: "POST",
      url: `/api/${businessId}/studio/billing/statements/${generated.id}/dispute`,
      headers: { cookie, "idempotency-key": `test-${randomUUID()}` },
      payload: { reason: "amount looks wrong" },
    });
    expect(dispute.statusCode).toBe(201);
    expect(dispute.json<{ status: string }>().status).toBe("disputed");

    // A stranger's statement id is 404, not another business's data.
    const { cookie: strangerCookie, businessId: strangerId } = await ownerAt();
    const stolen = await app.inject({
      method: "POST",
      url: `/api/${strangerId}/studio/billing/statements/${generated.id}/dispute`,
      headers: { cookie: strangerCookie, "idempotency-key": `test-${randomUUID()}` },
      payload: { reason: "not mine to see" },
    });
    expect(stolen.statusCode).toBe(404);
  });
});
