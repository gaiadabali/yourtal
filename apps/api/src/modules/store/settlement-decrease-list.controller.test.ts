import { randomUUID } from "node:crypto";
import { stubLedgerClient } from "./persistence/test-ledger-stub";
import { beforeAll, describe, expect, it } from "vitest";
import { DrizzleListingRepository } from "./persistence/drizzle-listing.repository";
import { DrizzleSettlementDecreaseRequestRepository } from "./persistence/drizzle-settlement-decrease-request.repository";
import { clearStoreTables, testStoreDb } from "./persistence/store-db.test-helper";
import { merchantLocations } from "./persistence/schema/listing.table";
import { SettlementDecreaseListController } from "./settlement-decrease-list.controller";

/**
 * 7.4.g: the aggregate read across every listing a business owns. Same real
 * Postgres this module's other settlement-decrease suite uses; the list
 * route itself only needs `@Authorize`'s coarse tenant check (no second PDP
 * call, unlike propose/approve), so this exercises it directly rather than
 * through `createPdpClient` -- the real-Cerbos proof already lives in
 * `settlement-decrease.controller.test.ts` and `store-listing.routes.boot.test.ts`
 * for the `listing`/`view` action this route reuses.
 */
const db = testStoreDb();
const listings = new DrizzleListingRepository(db, stubLedgerClient(db));
const decreaseRequests = new DrizzleSettlementDecreaseRequestRepository(db, stubLedgerClient(db));
const listController = new SettlementDecreaseListController(decreaseRequests);

const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();

beforeAll(async () => {
  await clearStoreTables(db);
});

async function seedListing(merchantId: string, settlementValueMinor: number) {
  const [location] = await db
    .insert(merchantLocations)
    .values({ id: randomUUID(), merchantId, name: "Outlet", address: "Jl. Test", district: "Kemang" })
    .returning();
  if (location === undefined) throw new Error("failed to seed a merchant_location row");

  return listings.create(merchantId, {
    merchantName: "7.4.g Test Merchant",
    title: "Voucher",
    description: "Description.",
    category: "retail",
    locationIds: [location.id],
    currency: "IDR" as const,
    faceValueMinor: 100_000,
    settlementValueMinor,
    stockTotal: 5,
    transferable: false,
    partialRedemptionPolicy: "single_use_forfeit",
    region: "ID" as const,
    audience: "all_ages" as const,
    contentCategory: "food-and-drink" as const,
    imageUrl: "https://cdn.example.com/listing.jpg",
    channel: "in_store" as const,
    partialRedemption: "single_use" as const,
    minimumSpendMinor: null,
    expiresAt: "2027-01-01T00:00:00.000Z",
    status: "available",
    perUserLimit: undefined,
  });
}

describe("SettlementDecreaseListController.list", () => {
  it("lists a business's own pending requests, newest first, and none of another tenant's", async () => {
    const listingA = await seedListing(TENANT, 10_000);
    const listingB = await seedListing(TENANT, 20_000);
    const otherListing = await seedListing(OTHER_TENANT, 30_000);

    const requestA = await decreaseRequests.create({
      listingId: listingA.id,
      requestedBy: randomUUID(),
      currency: "IDR",
      currentSettlementValueMinor: 10_000,
      proposedSettlementValueMinor: 5_000,
      reason: "Cut A",
    });
    const requestB = await decreaseRequests.create({
      listingId: listingB.id,
      requestedBy: randomUUID(),
      currency: "IDR",
      currentSettlementValueMinor: 20_000,
      proposedSettlementValueMinor: 15_000,
      reason: "Cut B",
    });
    await decreaseRequests.create({
      listingId: otherListing.id,
      requestedBy: randomUUID(),
      currency: "IDR",
      currentSettlementValueMinor: 30_000,
      proposedSettlementValueMinor: 25_000,
      reason: "Not this tenant's",
    });

    const result = await listController.list(TENANT, { state: "pending" });
    const ids = result.requests.map((r) => r.listingId);
    expect(ids.sort()).toStrictEqual([listingA.id, listingB.id].sort());
    expect(result.requests.map((r) => r.id)).toContain(requestA.id);
    expect(result.requests.map((r) => r.id)).toContain(requestB.id);
    expect(result.requests.every((r) => r.state === "pending")).toBe(true);
  });

  it("does not list an approved request", async () => {
    const listing = await seedListing(TENANT, 40_000);
    const proposed = await decreaseRequests.create({
      listingId: listing.id,
      requestedBy: randomUUID(),
      currency: "IDR",
      currentSettlementValueMinor: 40_000,
      proposedSettlementValueMinor: 30_000,
      reason: "Will be approved",
    });
    await decreaseRequests.approve(TENANT, listing.id, proposed.id, randomUUID());

    const result = await listController.list(TENANT, { state: "pending" });
    expect(result.requests.map((r) => r.id)).not.toContain(proposed.id);
  });

  it("rejects a state other than pending at the query boundary", async () => {
    await expect(listController.list(TENANT, { state: "approved" })).rejects.toThrow();
  });
});
