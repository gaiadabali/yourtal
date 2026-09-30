import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { sessionFor } from "../../shared/testing/session-for";
import { grantStaffRole, ownerPool } from "../staff/staff.test-helper";

/**
 * TASKS.md 12.4.c (F83): reward listings go through the SAME `categoryRefusal`
 * campaigns already use (1.1.d) -- a `prohibited` category is refused
 * outright and an `adult_only` one is forced to `audience: "adult"`, on
 * create AND edit, and again when staff moderation approves a flagged
 * listing (an override is not exempt from the policy it enforces).
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

async function createBusiness(ownerCookie: string) {
  const handle = `test-12-4-c-${randomUUID().slice(0, 8)}`;
  const created = await app.inject({
    method: "POST",
    url: "/api/businesses",
    headers: { cookie: ownerCookie, "idempotency-key": randomUUID() },
    payload: {
      legalName: `12.4.c Test Co ${handle}`,
      displayName: "12.4.c Test Business",
      taxIdKind: "ABN",
      taxIdValue: "12345678901",
      addressState: "NSW",
      addressPostcode: "2000",
      roles: ["advertiser", "supplier"],
      region: "AU",
      handle,
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  return created.json<{ business: { id: string } }>().business.id;
}

async function createLocation(ownerCookie: string, businessId: string) {
  const location = await app.inject({
    method: "POST",
    url: `/api/${businessId}/store/locations`,
    headers: { cookie: ownerCookie, "idempotency-key": randomUUID() },
    payload: { name: "Test Outlet", address: "1 Test St", district: "Testville" },
  });
  expect(location.statusCode, location.body).toBe(201);
  return location.json<{ id: string }>().id;
}

function createListingPayload(
  locationId: string,
  overrides?: { contentCategory?: string; audience?: string },
) {
  return {
    merchantName: "12.4.c Test Business",
    title: `12.4.c Test Listing ${randomUUID().slice(0, 8)}`,
    description: "Exercises the listing category policy.",
    category: "retail",
    locationIds: [locationId],
    faceValueMinor: 10_000,
    settlementValueMinor: 3_000,
    stockTotal: 10,
    transferable: false,
    partialRedemptionPolicy: "single_use_forfeit",
    minimumSpendMinor: null,
    expiresAt: "2027-01-01T00:00:00.000Z",
    status: "available",
    audience: overrides?.audience ?? "all_ages",
    contentCategory: overrides?.contentCategory ?? "food-and-drink",
    imageUrl: "https://cdn.example.com/listing.jpg",
    channel: "in_store",
    partialRedemption: "single_use",
  };
}

async function createListing(
  ownerCookie: string,
  businessId: string,
  locationId: string,
  overrides?: { contentCategory?: string; audience?: string },
) {
  return app.inject({
    method: "POST",
    url: `/api/${businessId}/store/listings`,
    headers: { cookie: ownerCookie, "idempotency-key": randomUUID() },
    payload: createListingPayload(locationId, overrides),
  });
}

async function opsStaff() {
  const staff = await sessionFor(app, { jurisdiction: "AU" });
  await grantStaffRole(ownerPool(), staff.userId, "ops");
  return staff;
}

describe("12.4.c: store listing category policy on create", () => {
  it("refuses a prohibited category outright -- vaping is prohibited in AU", async () => {
    const owner = await sessionFor(app, { jurisdiction: "AU" });
    const businessId = await createBusiness(owner.cookie);
    const locationId = await createLocation(owner.cookie, businessId);

    const created = await createListing(owner.cookie, businessId, locationId, {
      contentCategory: "vaping",
      audience: "adult",
    });
    expect(created.statusCode).toBe(400);
    expect(created.json<{ code: string }>().code).toBe("prohibited_category");
  });

  it("refuses an adult_only category paired with a non-adult audience", async () => {
    const owner = await sessionFor(app, { jurisdiction: "AU" });
    const businessId = await createBusiness(owner.cookie);
    const locationId = await createLocation(owner.cookie, businessId);

    const created = await createListing(owner.cookie, businessId, locationId, {
      contentCategory: "alcohol",
      audience: "all_ages",
    });
    expect(created.statusCode).toBe(400);
    expect(created.json<{ code: string }>().code).toBe("audience_must_be_adult");
  });

  it("refuses an adult_only category for a teen audience too, since a teen reaches all_ages/teen only", async () => {
    const owner = await sessionFor(app, { jurisdiction: "AU" });
    const businessId = await createBusiness(owner.cookie);
    const locationId = await createLocation(owner.cookie, businessId);

    const created = await createListing(owner.cookie, businessId, locationId, {
      contentCategory: "gambling",
      audience: "teen",
    });
    expect(created.statusCode).toBe(400);
    expect(created.json<{ code: string }>().code).toBe("audience_must_be_adult");
  });

  it("allows an adult_only category when the audience is adult", async () => {
    const owner = await sessionFor(app, { jurisdiction: "AU" });
    const businessId = await createBusiness(owner.cookie);
    const locationId = await createLocation(owner.cookie, businessId);

    const created = await createListing(owner.cookie, businessId, locationId, {
      contentCategory: "alcohol",
      audience: "adult",
    });
    expect(created.statusCode, created.body).toBe(201);
  });

  it("allows an ordinary category with any audience", async () => {
    const owner = await sessionFor(app, { jurisdiction: "AU" });
    const businessId = await createBusiness(owner.cookie);
    const locationId = await createLocation(owner.cookie, businessId);

    const created = await createListing(owner.cookie, businessId, locationId, {
      contentCategory: "electronics",
      audience: "all_ages",
    });
    expect(created.statusCode, created.body).toBe(201);
  });
});

describe("12.4.c: store listing category policy on edit", () => {
  it("refuses editing an ordinary listing's category into a prohibited one", async () => {
    const owner = await sessionFor(app, { jurisdiction: "AU" });
    const businessId = await createBusiness(owner.cookie);
    const locationId = await createLocation(owner.cookie, businessId);
    const created = await createListing(owner.cookie, businessId, locationId);
    expect(created.statusCode, created.body).toBe(201);
    const listingId = created.json<{ id: string }>().id;

    const edited = await app.inject({
      method: "PATCH",
      url: `/api/${businessId}/store/listings/${listingId}`,
      headers: { cookie: owner.cookie },
      payload: { contentCategory: "tobacco" },
    });
    expect(edited.statusCode).toBe(400);
    expect(edited.json<{ code: string }>().code).toBe("prohibited_category");
  });

  it("refuses editing into an adult_only category without also setting audience to adult", async () => {
    const owner = await sessionFor(app, { jurisdiction: "AU" });
    const businessId = await createBusiness(owner.cookie);
    const locationId = await createLocation(owner.cookie, businessId);
    const created = await createListing(owner.cookie, businessId, locationId);
    expect(created.statusCode, created.body).toBe(201);
    const listingId = created.json<{ id: string }>().id;

    const edited = await app.inject({
      method: "PATCH",
      url: `/api/${businessId}/store/listings/${listingId}`,
      headers: { cookie: owner.cookie },
      payload: { contentCategory: "dating" },
    });
    expect(edited.statusCode).toBe(400);
    expect(edited.json<{ code: string }>().code).toBe("audience_must_be_adult");
  });

  it("allows editing into an adult_only category when audience is set to adult in the same edit", async () => {
    const owner = await sessionFor(app, { jurisdiction: "AU" });
    const businessId = await createBusiness(owner.cookie);
    const locationId = await createLocation(owner.cookie, businessId);
    const created = await createListing(owner.cookie, businessId, locationId);
    expect(created.statusCode, created.body).toBe(201);
    const listingId = created.json<{ id: string }>().id;

    const edited = await app.inject({
      method: "PATCH",
      url: `/api/${businessId}/store/listings/${listingId}`,
      headers: { cookie: owner.cookie },
      payload: { contentCategory: "dating", audience: "adult" },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json<{ contentCategory: string; audience: string }>()).toMatchObject({
      contentCategory: "dating",
      audience: "adult",
    });
  });

  it("allows an ordinary field edit that leaves category/audience untouched", async () => {
    const owner = await sessionFor(app, { jurisdiction: "AU" });
    const businessId = await createBusiness(owner.cookie);
    const locationId = await createLocation(owner.cookie, businessId);
    const created = await createListing(owner.cookie, businessId, locationId);
    expect(created.statusCode, created.body).toBe(201);
    const listingId = created.json<{ id: string }>().id;

    const edited = await app.inject({
      method: "PATCH",
      url: `/api/${businessId}/store/listings/${listingId}`,
      headers: { cookie: owner.cookie },
      payload: { title: "Updated title" },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json<{ title: string }>().title).toBe("Updated title");
  });
});

describe("12.4.c: staff moderation approve override re-checks the same policy", () => {
  it("refuses an override that would make the listing prohibited", async () => {
    const owner = await sessionFor(app, { jurisdiction: "AU" });
    const businessId = await createBusiness(owner.cookie);
    const locationId = await createLocation(owner.cookie, businessId);
    // adult_only -> pending_review, so there's a queued row to approve.
    const created = await createListing(owner.cookie, businessId, locationId, {
      contentCategory: "alcohol",
      audience: "adult",
    });
    expect(created.statusCode, created.body).toBe(201);
    const listingId = created.json<{ id: string }>().id;
    const staff = await opsStaff();

    const approved = await app.inject({
      method: "POST",
      url: `/api/staff/moderation/listings/${listingId}/approve`,
      headers: { cookie: staff.cookie, "idempotency-key": randomUUID() },
      payload: {
        reason: "trying to wave a prohibited category through",
        contentCategory: "vaping",
      },
    });
    expect(approved.statusCode).toBe(400);
    expect(approved.json<{ code: string }>().code).toBe("prohibited_category");
  });

  it("applies a confirmed category/audience override and it sticks on the live listing", async () => {
    const owner = await sessionFor(app, { jurisdiction: "AU" });
    const businessId = await createBusiness(owner.cookie);
    const locationId = await createLocation(owner.cookie, businessId);
    const created = await createListing(owner.cookie, businessId, locationId, {
      contentCategory: "alcohol",
      audience: "adult",
    });
    expect(created.statusCode, created.body).toBe(201);
    const listingId = created.json<{ id: string }>().id;
    const staff = await opsStaff();

    const approved = await app.inject({
      method: "POST",
      url: `/api/staff/moderation/listings/${listingId}/approve`,
      headers: { cookie: staff.cookie, "idempotency-key": randomUUID() },
      payload: {
        reason: "correcting the misclassified category",
        contentCategory: "dating",
        audience: "adult",
      },
    });
    expect(approved.statusCode, approved.body).toBe(201);
    expect(
      approved.json<{ lifecycleState: string; contentCategory: string; audience: string }>(),
    ).toMatchObject({ lifecycleState: "active", contentCategory: "dating", audience: "adult" });

    const viewer = await sessionFor(app, { jurisdiction: "AU" });
    const afterApproval = await app.inject({
      method: "GET",
      url: `/api/store/listings/${listingId}`,
      headers: { cookie: viewer.cookie },
    });
    expect(afterApproval.statusCode, afterApproval.body).toBe(200);
    expect(afterApproval.json<{ contentCategory: string }>().contentCategory).toBe("dating");
  });
});
