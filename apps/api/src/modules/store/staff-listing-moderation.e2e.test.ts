import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { sessionFor } from "../../shared/testing/session-for";
import { grantStaffRole, ownerPool } from "../staff/staff.test-helper";

/**
 * TASKS.md 9.2.a: the listing half of the staff moderation queue. Only a
 * listing the automated screen flags (an `adult_only` `contentCategory`,
 * per 1.1.d) ever reaches `pending_review` -- an ordinary listing is
 * `active` from creation, unchanged (proven by the first test below).
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
  const handle = `test-9-2-a-listing-${randomUUID().slice(0, 8)}`;
  const created = await app.inject({
    method: "POST",
    url: "/api/businesses",
    headers: { cookie: ownerCookie, "idempotency-key": randomUUID() },
    payload: {
      legalName: `9.2.a Test Co ${handle}`,
      displayName: "9.2.a Test Business",
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

async function createListing(
  ownerCookie: string,
  businessId: string,
  overrides?: { contentCategory?: string; audience?: string },
) {
  const location = await app.inject({
    method: "POST",
    url: `/api/${businessId}/store/locations`,
    headers: { cookie: ownerCookie, "idempotency-key": randomUUID() },
    payload: { name: "Test Outlet", address: "1 Test St", district: "Testville" },
  });
  expect(location.statusCode, location.body).toBe(201);
  const locationId = location.json<{ id: string }>().id;

  const listing = await app.inject({
    method: "POST",
    url: `/api/${businessId}/store/listings`,
    headers: { cookie: ownerCookie, "idempotency-key": randomUUID() },
    payload: {
      merchantName: "9.2.a Test Business",
      title: "9.2.a Test Listing",
      description: "Exercises the staff listing moderation flow.",
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
    },
  });
  expect(listing.statusCode, listing.body).toBe(201);
  return listing.json<{ id: string }>().id;
}

async function opsStaff() {
  const staff = await sessionFor(app, { jurisdiction: "AU" });
  await grantStaffRole(ownerPool(), staff.userId, "ops");
  return staff;
}

describe("9.2.a: staff listing moderation", () => {
  it("an ordinary listing goes straight to the public catalogue, unaffected", async () => {
    const owner = await sessionFor(app, { jurisdiction: "AU" });
    const businessId = await createBusiness(owner.cookie);
    const listingId = await createListing(owner.cookie, businessId);

    const publicListing = await app.inject({
      method: "GET",
      url: `/api/store/listings/${listingId}?region=AU`,
    });
    expect(publicListing.statusCode, publicListing.body).toBe(200);
  });

  it("an adult_only category is flagged for review and stays out of the public catalogue until approved", async () => {
    const owner = await sessionFor(app, { jurisdiction: "AU" });
    const businessId = await createBusiness(owner.cookie);
    const listingId = await createListing(owner.cookie, businessId, {
      contentCategory: "alcohol",
      audience: "adult",
    });

    const beforeApproval = await app.inject({
      method: "GET",
      url: `/api/store/listings/${listingId}?region=AU`,
    });
    expect(beforeApproval.statusCode).toBe(404);

    const staff = await opsStaff();
    const list = await app.inject({
      method: "GET",
      url: "/api/staff/moderation/listings",
      headers: { cookie: staff.cookie },
    });
    expect(list.statusCode, list.body).toBe(200);
    const ids = list.json<{ listings: Array<{ id: string }> }>().listings.map((row) => row.id);
    expect(ids).toContain(listingId);

    const approved = await app.inject({
      method: "POST",
      url: `/api/staff/moderation/listings/${listingId}/approve`,
      headers: { cookie: staff.cookie, "idempotency-key": randomUUID() },
      payload: { reason: "adult_only category correctly declared, approved" },
    });
    expect(approved.statusCode, approved.body).toBe(201);
    expect(approved.json<{ lifecycleState: string }>().lifecycleState).toBe("active");

    // Signed in, not anonymous: an adult_only listing's own `audience:
    // "adult"` is unreachable to an anonymous browse (all_ages only) --
    // that is the audience wall working correctly, not this feature.
    // Every account is effectively adult until 12.x's teen accounts exist
    // (TASKS.md 1.1.c).
    const viewer = await sessionFor(app, { jurisdiction: "AU" });
    const afterApproval = await app.inject({
      method: "GET",
      url: `/api/store/listings/${listingId}`,
      headers: { cookie: viewer.cookie },
    });
    expect(afterApproval.statusCode, afterApproval.body).toBe(200);
  });

  it("a rejected listing carries the reason and never reaches the public catalogue", async () => {
    const owner = await sessionFor(app, { jurisdiction: "AU" });
    const businessId = await createBusiness(owner.cookie);
    const listingId = await createListing(owner.cookie, businessId, {
      contentCategory: "dating",
      audience: "adult",
    });
    const staff = await opsStaff();

    const rejected = await app.inject({
      method: "POST",
      url: `/api/staff/moderation/listings/${listingId}/reject`,
      headers: { cookie: staff.cookie, "idempotency-key": randomUUID() },
      payload: { reason: "creative does not meet the platform's dating-category guidelines" },
    });
    expect(rejected.statusCode, rejected.body).toBe(201);
    expect(
      rejected.json<{ lifecycleState: string; rejectionReason: string | null }>(),
    ).toMatchObject({
      lifecycleState: "rejected",
      rejectionReason: "creative does not meet the platform's dating-category guidelines",
    });

    const publicListing = await app.inject({
      method: "GET",
      url: `/api/store/listings/${listingId}?region=AU`,
    });
    expect(publicListing.statusCode).toBe(404);

    const audit = await ownerPool().query(
      `SELECT outcome, reason FROM staff.audit_event WHERE action = $1 AND target_id = $2`,
      ["listing_moderation.reject", listingId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ outcome: "succeeded" });
  });

  it("a business (not staff) cannot reach the listing moderation queue", async () => {
    const owner = await sessionFor(app, { jurisdiction: "AU" });
    const businessId = await createBusiness(owner.cookie);
    const listingId = await createListing(owner.cookie, businessId, {
      contentCategory: "alcohol",
      audience: "adult",
    });

    const approved = await app.inject({
      method: "POST",
      url: `/api/staff/moderation/listings/${listingId}/approve`,
      headers: { cookie: owner.cookie, "idempotency-key": randomUUID() },
      payload: { reason: "trying anyway" },
    });
    expect(approved.statusCode).toBe(403);
  });

  it("an already-decided listing cannot be approved again", async () => {
    const owner = await sessionFor(app, { jurisdiction: "AU" });
    const businessId = await createBusiness(owner.cookie);
    const listingId = await createListing(owner.cookie, businessId, {
      contentCategory: "alcohol",
      audience: "adult",
    });
    const staff = await opsStaff();

    const first = await app.inject({
      method: "POST",
      url: `/api/staff/moderation/listings/${listingId}/approve`,
      headers: { cookie: staff.cookie, "idempotency-key": randomUUID() },
      payload: { reason: "looks fine" },
    });
    expect(first.statusCode, first.body).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: `/api/staff/moderation/listings/${listingId}/approve`,
      headers: { cookie: staff.cookie, "idempotency-key": randomUUID() },
      payload: { reason: "looks fine" },
    });
    expect(second.statusCode).toBe(400);
  });
});
