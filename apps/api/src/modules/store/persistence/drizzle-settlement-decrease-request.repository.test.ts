import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { DrizzleListingRepository } from "./drizzle-listing.repository";
import { DrizzleListingPriceRevisionRepository } from "./drizzle-listing-price-revision.repository";
import { DrizzleSettlementDecreaseRequestRepository } from "./drizzle-settlement-decrease-request.repository";
import { clearStoreTables, testStoreDb } from "./store-db.test-helper";
import { merchantLocations } from "./schema/listing.table";

/**
 * `store.settlement_decrease_request` (YT-0575) against real Postgres.
 *
 * The point of this suite is `approve`'s WHERE clause: proving a
 * self-approval attempt matches no row rather than trusting that nobody
 * calls it with the same id twice. See "self-approval matches no row" below
 * -- it is the sabotage proof for the ticket's central claim.
 */
const db = testStoreDb();
const listings = new DrizzleListingRepository(db);
const priceRevisions = new DrizzleListingPriceRevisionRepository(db);
const requests = new DrizzleSettlementDecreaseRequestRepository(db);

const MERCHANT = "00000000-0000-4000-8000-0000000d0001";
const REQUESTER = "00000000-0000-4000-8000-0000000d0002";
const APPROVER = "00000000-0000-4000-8000-0000000d0003";

beforeAll(async () => {
  await clearStoreTables(db);
});

async function seedListing(settlementValueMinor: number) {
  const [location] = await db
    .insert(merchantLocations)
    .values({
      id: randomUUID(),
      merchantId: MERCHANT,
      name: "Outlet",
      address: "Jl. Test",
      district: "Kemang",
    })
    .returning();
  if (location === undefined) throw new Error("failed to seed a merchant_location row");

  return listings.create(MERCHANT, {
    merchantName: "Settlement Decrease Test",
    title: "Voucher",
    description: "Description.",
    category: "retail",
    locationIds: [location.id],
    currency: "IDR" as const,
    faceValueMinor: 10_000_000,
    settlementValueMinor,
    priceInPoints: 1_000,
    stockTotal: 5,
    transferable: false,
    partialRedemptionPolicy: "single_use_forfeit",
    minimumSpendMinor: null,
    expiresAt: "2027-01-01T00:00:00.000Z",
    status: "available",
    perUserLimit: undefined,
  });
}

describe("create + findPendingForListing + findById", () => {
  it("round-trips a proposed request as pending", async () => {
    const listing = await seedListing(1_000_000);
    const created = await requests.create({
      listingId: listing.id,
      requestedBy: REQUESTER,
      currency: "IDR" as const,
      currentSettlementValueMinor: 1_000_000,
      proposedSettlementValueMinor: 500_000,
      reason: "Big cut.",
    });

    expect(created.state).toBe("pending");
    expect(created.approvedBy).toBeNull();
    expect(created.approvedAt).toBeNull();

    const pending = await requests.findPendingForListing(listing.id);
    expect(pending?.id).toBe(created.id);

    const byId = await requests.findById(listing.id, created.id);
    expect(byId?.proposedSettlementValueMinor).toBe(500_000);
  });

  it("findPendingForListing is null once nothing is pending for that listing", async () => {
    const listing = await seedListing(1_000_000);
    expect(await requests.findPendingForListing(listing.id)).toBeNull();
  });
});

describe("a second pending request for the same listing is unrepresentable", () => {
  it("is refused by the partial unique index, not merely by a check that runs first", async () => {
    const listing = await seedListing(1_000_000);
    await requests.create({
      listingId: listing.id,
      requestedBy: REQUESTER,
      currency: "IDR" as const,
      currentSettlementValueMinor: 1_000_000,
      proposedSettlementValueMinor: 500_000,
      reason: "First cut.",
    });

    // No application-level guard here on purpose -- this proves the DATABASE
    // refuses a second pending row for the same listing, the actual
    // enforcement `settlement_decrease_request_one_pending_uidx` gives.
    await expect(
      requests.create({
        listingId: listing.id,
        requestedBy: REQUESTER,
        currency: "IDR" as const,
        currentSettlementValueMinor: 1_000_000,
        proposedSettlementValueMinor: 600_000,
        reason: "Second cut, while the first is still pending.",
      }),
    ).rejects.toThrow();
  });
});

describe("approve", () => {
  it("claims the request, applies the value, and links the audit row to it", async () => {
    const listing = await seedListing(1_000_000);
    const created = await requests.create({
      listingId: listing.id,
      requestedBy: REQUESTER,
      currency: "IDR" as const,
      currentSettlementValueMinor: 1_000_000,
      proposedSettlementValueMinor: 500_000,
      reason: "Big cut.",
    });

    const change = await requests.approve(MERCHANT, listing.id, created.id, APPROVER);
    expect(change?.updated.settlementValueMinor).toBe(500_000);
    expect(change?.previous.settlementValueMinor).toBe(1_000_000);

    const resolved = await requests.findById(listing.id, created.id);
    expect(resolved?.state).toBe("approved");
    expect(resolved?.approvedBy).toBe(APPROVER);
    expect(resolved?.approvedAt).not.toBeNull();

    const revisions = await priceRevisions.listForListing(listing.id);
    const linked = revisions.find((row) => row.newSettlementValueMinor === 500_000);
    expect(linked?.requestedBy).toBe(REQUESTER);
  });

  it("SELF-APPROVAL: the same person who requested it matches no row and nothing applies", async () => {
    const listing = await seedListing(1_000_000);
    const created = await requests.create({
      listingId: listing.id,
      requestedBy: REQUESTER,
      currency: "IDR" as const,
      currentSettlementValueMinor: 1_000_000,
      proposedSettlementValueMinor: 500_000,
      reason: "Self-approval attempt.",
    });

    // Sabotage: the requester tries to approve their own request.
    const change = await requests.approve(MERCHANT, listing.id, created.id, REQUESTER);
    expect(change).toBeNull();

    // And it left no trace of having half-happened: still pending, listing
    // untouched, no audit row for this value.
    const stillPending = await requests.findById(listing.id, created.id);
    expect(stillPending?.state).toBe("pending");
    expect(stillPending?.approvedBy).toBeNull();

    const unchanged = await listings.findOwnedById(MERCHANT, listing.id);
    expect(unchanged?.settlementValueMinor).toBe(1_000_000);
  });

  it("a second approval attempt (already resolved) also matches no row", async () => {
    const listing = await seedListing(1_000_000);
    const created = await requests.create({
      listingId: listing.id,
      requestedBy: REQUESTER,
      currency: "IDR" as const,
      currentSettlementValueMinor: 1_000_000,
      proposedSettlementValueMinor: 500_000,
      reason: "First approval.",
    });
    const first = await requests.approve(MERCHANT, listing.id, created.id, APPROVER);
    expect(first).not.toBeNull();

    const second = await requests.approve(MERCHANT, listing.id, created.id, APPROVER);
    expect(second).toBeNull();

    // The value from the first approval is not double-applied or reverted.
    const listingNow = await listings.findOwnedById(MERCHANT, listing.id);
    expect(listingNow?.settlementValueMinor).toBe(500_000);
  });

  it("a nonexistent request matches no row", async () => {
    const listing = await seedListing(1_000_000);
    const result = await requests.approve(MERCHANT, listing.id, randomUUID(), APPROVER);
    expect(result).toBeNull();
  });
});
