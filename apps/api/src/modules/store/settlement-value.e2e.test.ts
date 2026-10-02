import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { sessionFor, type TestSession } from "../../shared/testing/session-for";
import { ownerPool } from "../staff/staff.test-helper";

/**
 * 13.3.b (journey 4), over real HTTP: a merchandiser raises S and it applies;
 * a cut becomes a request the merchandiser cannot approve and the owner can.
 * Both used to be refused for everyone: the coarse gate asked for an action
 * it could never satisfy, and the explicit check used a principal with no
 * business roles. Controller-method tests skip both.
 */
let app: NestFastifyApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

async function call(session: TestSession, method: "GET" | "POST", url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: { cookie: session.cookie, "idempotency-key": randomUUID() },
    ...(payload === undefined ? {} : { payload }),
  });
}

async function supplierWithMerchandiser() {
  const owner = await sessionFor(app, { jurisdiction: "AU" });
  const handle = `s-value-${randomUUID().slice(0, 8)}`;
  const created = await call(owner, "POST", "/api/businesses", {
    legalName: `S Value Co ${handle}`,
    displayName: "S Value Co",
    taxIdKind: "ABN",
    taxIdValue: "12345678901",
    addressState: "VIC",
    addressPostcode: "3000",
    roles: ["supplier"],
    region: "AU",
    handle,
  });
  expect(created.statusCode, created.body).toBe(201);
  const businessId = created.json<{ business: { id: string } }>().business.id;
  const merchandiser = await sessionFor(app, { jurisdiction: "AU" });
  await ownerPool().query(
    `INSERT INTO business.business_members (business_id, user_id, role, invited_by_user_id, joined_at)
     VALUES ($1, $2, 'merchandiser', $3, now())`,
    [businessId, merchandiser.userId, owner.userId],
  );
  const location = await call(merchandiser, "POST", `/api/${businessId}/store/locations`, {
    name: "Laneway",
    address: "1 Degraves St",
    district: "Melbourne",
  });
  expect(location.statusCode, location.body).toBe(201);
  const listing = await call(merchandiser, "POST", `/api/${businessId}/store/listings`, {
    merchantName: "S Value Co",
    title: "Flat white",
    description: "One flat white.",
    category: "food_beverage",
    locationIds: [location.json<{ id: string }>().id],
    faceValueMinor: 1_000,
    settlementValueMinor: 700,
    stockTotal: 5,
    transferable: false,
    partialRedemptionPolicy: "single_use_forfeit",
    minimumSpendMinor: null,
    expiresAt: "2027-06-01T00:00:00.000Z",
    status: "available",
    audience: "all_ages",
    contentCategory: "food-and-drink",
    imageUrl: "https://cdn.example.com/flat-white.jpg",
    channel: "in_store",
    partialRedemption: "single_use",
  });
  expect(listing.statusCode, listing.body).toBe(201);
  return { owner, merchandiser, businessId, listingId: listing.json<{ id: string }>().id };
}

describe("13.3.b: changing a listing's S over HTTP", () => {
  it("a merchandiser's rise applies; their cut waits for, and gets, the owner's approval", async () => {
    const { owner, merchandiser, businessId, listingId } = await supplierWithMerchandiser();
    const base = `/api/${businessId}/store/listings/${listingId}`;

    const raised = await call(merchandiser, "POST", `${base}/settlement-value`, {
      newSettlementValueMinor: 750,
      reason: "Costs went up.",
    });
    expect(raised.statusCode, raised.body).toBe(201);
    expect(
      raised.json<{ updated: { settlementValueMinor: number } }>().updated.settlementValueMinor,
    ).toBe(750);

    const direct = await call(merchandiser, "POST", `${base}/settlement-value`, {
      newSettlementValueMinor: 600,
      reason: "Promotion.",
    });
    expect(direct.statusCode).toBe(403);

    const proposed = await call(merchandiser, "POST", `${base}/settlement-decrease-requests`, {
      proposedSettlementValueMinor: 600,
      reason: "Promotion.",
    });
    expect(proposed.statusCode, proposed.body).toBe(201);
    const requestId = proposed.json<{ id: string }>().id;

    const self = await call(
      merchandiser,
      "POST",
      `${base}/settlement-decrease-requests/${requestId}/approve`,
      {},
    );
    expect(self.statusCode).toBe(403);
    const approved = await call(
      owner,
      "POST",
      `${base}/settlement-decrease-requests/${requestId}/approve`,
      {},
    );
    expect(approved.statusCode, approved.body).toBe(201);

    const listing = await call(owner, "GET", base);
    expect(listing.json<{ settlementValueMinor: number }>().settlementValueMinor).toBe(600);
  });
});
