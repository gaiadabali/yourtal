import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { sessionFor } from "../../shared/testing/session-for";
import { findListingForCheckout } from "../checkout/persistence/listing-for-checkout";
import { grantStaffRole, ownerPool } from "../staff/staff.test-helper";

/**
 * TASKS.md 9.2.c's Check: a real business, listing and voucher-batch
 * request, all through real HTTP, then a `moderator` staffer approves it --
 * proving the endpoint really calls 4.5's `VoucherInternalClient.
 * requestBatch`/`approveBatch` (the fake, here -- `pnpm check`'s own speed
 * budget; the same client's live twin is `voucher-client.contract.spec.ts`'s
 * job) and really claims the row with `approved_by <> requested_by`.
 * `staff-voucher-batch-review.live.test.ts` is the sibling proof that stock
 * (a live projection of `voucher.vouchers`) actually rises, against the
 * real Go voucher engine.
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
  const handle = `test-9-2-c-${randomUUID().slice(0, 8)}`;
  const created = await app.inject({
    method: "POST",
    url: "/api/businesses",
    headers: { cookie: ownerCookie, "idempotency-key": randomUUID() },
    payload: {
      legalName: `9.2.c Test Co ${handle}`,
      displayName: "9.2.c Test Business",
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

async function createListing(ownerCookie: string, businessId: string, stockTotal = 10) {
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
      merchantName: "9.2.c Test Business",
      title: "9.2.c Test Listing",
      description: "Exercises the staff voucher-batch approval flow.",
      category: "retail",
      locationIds: [locationId],
      faceValueMinor: 10_000,
      settlementValueMinor: 3_000,
      stockTotal,
      transferable: false,
      partialRedemptionPolicy: "single_use_forfeit",
      minimumSpendMinor: null,
      expiresAt: "2027-01-01T00:00:00.000Z",
      status: "available",
      audience: "all_ages",
      contentCategory: "food-and-drink",
      imageUrl: "https://cdn.example.com/listing.jpg",
      channel: "in_store",
      partialRedemption: "single_use",
    },
  });
  expect(listing.statusCode, listing.body).toBe(201);
  return listing.json<{ id: string }>().id;
}

async function requestBatch(
  ownerCookie: string,
  businessId: string,
  listingId: string,
  quantity = 5,
) {
  const requested = await app.inject({
    method: "POST",
    url: `/api/${businessId}/store/voucher-batch-requests`,
    headers: { cookie: ownerCookie, "idempotency-key": randomUUID() },
    payload: { listingId, quantity, reason: "restocking for a promotion" },
  });
  expect(requested.statusCode, requested.body).toBe(201);
  return requested.json<{ id: string; requestedBy: string }>();
}

async function moderatorStaff() {
  const staff = await sessionFor(app, { jurisdiction: "AU" });
  await grantStaffRole(ownerPool(), staff.userId, "moderator");
  return staff;
}

describe("9.2.c: staff voucher-batch approval", () => {
  it("a moderator approves a pending request: it mints through 4.5 and the row is claimed", async () => {
    const owner = await sessionFor(app, { jurisdiction: "AU" });
    const businessId = await createBusiness(owner.cookie);
    const listingId = await createListing(owner.cookie, businessId);
    const requested = await requestBatch(owner.cookie, businessId, listingId);
    const staff = await moderatorStaff();

    const approved = await app.inject({
      method: "POST",
      url: `/api/staff/moderation/voucher-batches/${requested.id}/approve`,
      headers: { cookie: staff.cookie, "idempotency-key": randomUUID() },
      payload: { reason: "stock request looks legitimate" },
    });
    expect(approved.statusCode, approved.body).toBe(201);
    const body = approved.json<{
      state: string;
      approvedBy: string;
      mintedBatchId: string | null;
    }>();
    expect(body.state).toBe("approved");
    expect(body.approvedBy).toBe(staff.userId);
    expect(body.mintedBatchId).not.toBeNull();

    const owner2 = ownerPool();
    const { rows } = await owner2.query(
      `SELECT action, outcome, reason, detail FROM staff.audit_event WHERE action = $1 AND target_id = $2`,
      ["voucher_batch.approve", requested.id],
    );
    await owner2.end();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      outcome: "succeeded",
      reason: "stock request looks legitimate",
    });
  });

  it("13.3.w: approving a batch makes the merchant's new listing buyable at checkout", async () => {
    const owner = await sessionFor(app, { jurisdiction: "AU" });
    const businessId = await createBusiness(owner.cookie);
    const listingId = await createListing(owner.cookie, businessId, 3);
    const requested = await requestBatch(owner.cookie, businessId, listingId, 5);
    const staff = await moderatorStaff();
    const db = createAppDb(process.env["DATABASE_OWNER_URL"] ?? "");

    expect((await findListingForCheckout(db, listingId))?.buyable).toBe(false);

    const approved = await app.inject({
      method: "POST",
      url: `/api/staff/moderation/voucher-batches/${requested.id}/approve`,
      headers: { cookie: staff.cookie, "idempotency-key": randomUUID() },
      payload: { reason: "stock request looks legitimate" },
    });
    expect(approved.statusCode, approved.body).toBe(201);

    expect((await findListingForCheckout(db, listingId))?.buyable).toBe(true);
    const pool = ownerPool();
    const { rows } = await pool.query<{ stock_remaining: number; stock_total: number }>(
      `SELECT stock_remaining, stock_total FROM store.listings WHERE id = $1`,
      [listingId],
    );
    await pool.end();
    // Raised by exactly the batch; the declared total grows only because 5 > 3.
    expect(rows[0]).toEqual({ stock_remaining: 5, stock_total: 5 });
  });

  it("a moderator rejects a pending request", async () => {
    const owner = await sessionFor(app, { jurisdiction: "AU" });
    const businessId = await createBusiness(owner.cookie);
    const listingId = await createListing(owner.cookie, businessId);
    const requested = await requestBatch(owner.cookie, businessId, listingId);
    const staff = await moderatorStaff();

    const rejected = await app.inject({
      method: "POST",
      url: `/api/staff/moderation/voucher-batches/${requested.id}/reject`,
      headers: { cookie: staff.cookie, "idempotency-key": randomUUID() },
      payload: { reason: "quantity looks excessive for this listing's history" },
    });
    expect(rejected.statusCode, rejected.body).toBe(201);
    expect(rejected.json<{ state: string; mintedBatchId: string | null }>()).toMatchObject({
      state: "rejected",
      mintedBatchId: null,
    });
  });

  it("a business owner (not staff) cannot approve batches through the moderation queue", async () => {
    const owner = await sessionFor(app, { jurisdiction: "AU" });
    const businessId = await createBusiness(owner.cookie);
    const listingId = await createListing(owner.cookie, businessId);
    const requested = await requestBatch(owner.cookie, businessId, listingId);

    const approved = await app.inject({
      method: "POST",
      url: `/api/staff/moderation/voucher-batches/${requested.id}/approve`,
      headers: { cookie: owner.cookie, "idempotency-key": randomUUID() },
      payload: { reason: "trying anyway" },
    });
    expect(approved.statusCode).toBe(403);
  });

  it("an already-approved request cannot be approved again", async () => {
    const owner = await sessionFor(app, { jurisdiction: "AU" });
    const businessId = await createBusiness(owner.cookie);
    const listingId = await createListing(owner.cookie, businessId);
    const requested = await requestBatch(owner.cookie, businessId, listingId);
    const staff = await moderatorStaff();

    const first = await app.inject({
      method: "POST",
      url: `/api/staff/moderation/voucher-batches/${requested.id}/approve`,
      headers: { cookie: staff.cookie, "idempotency-key": randomUUID() },
      payload: { reason: "looks fine" },
    });
    expect(first.statusCode, first.body).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: `/api/staff/moderation/voucher-batches/${requested.id}/approve`,
      headers: { cookie: staff.cookie, "idempotency-key": randomUUID() },
      payload: { reason: "looks fine" },
    });
    expect(second.statusCode).toBe(404);
  });

  it("lists every pending request", async () => {
    const owner = await sessionFor(app, { jurisdiction: "AU" });
    const businessId = await createBusiness(owner.cookie);
    const listingId = await createListing(owner.cookie, businessId);
    const requested = await requestBatch(owner.cookie, businessId, listingId);
    const staff = await moderatorStaff();

    const list = await app.inject({
      method: "GET",
      url: "/api/staff/moderation/voucher-batches",
      headers: { cookie: staff.cookie },
    });
    expect(list.statusCode, list.body).toBe(200);
    const ids = list
      .json<{ requests: Array<{ id: string; state: string }> }>()
      .requests.map((r) => r.id);
    expect(ids).toContain(requested.id);
  });
});
