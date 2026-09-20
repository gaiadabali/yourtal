import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { DrizzleListingPriceRevisionRepository } from "./drizzle-listing-price-revision.repository";
import { DrizzleListingRepository } from "./drizzle-listing.repository";
import { clearStoreTables, testStoreDb } from "./store-db.test-helper";
import { merchantLocations } from "./schema/listing.table";
import type { CreateListingInput } from "./listing.repository";

/**
 * The one operation this ticket calls out by name: changing a listing's
 * settlement value `S` must be audit-logged (docs/17 section 2.1), and must
 * NEVER recompute `price_in_points` -- this module has no grant on the
 * ledger schema to do that correctly. See
 * `packages/db/migrations/20260920040000_store_listing_management.sql`.
 */
const db = testStoreDb();
const repo = new DrizzleListingRepository(db);
const revisions = new DrizzleListingPriceRevisionRepository(db);

const MERCHANT = "00000000-0000-4000-8000-0000000b0001";

beforeAll(async () => {
  await clearStoreTables(db);
});

async function createListing(overrides: Partial<CreateListingInput> = {}) {
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

  return repo.create(MERCHANT, {
    merchantName: "Repricing Test Merchant",
    title: "Voucher Repricing Test",
    description: "Exercises the settlement-value audit trail.",
    category: "retail",
    locationIds: [location.id],
    faceValueIdr: 10_000_000,
    settlementValueIdr: 3_000_000,
    priceInPoints: 5_000,
    stockTotal: 5,
    transferable: false,
    partialRedemptionPolicy: "single_use_forfeit",
    minimumSpendIdr: null,
    expiresAt: "2027-01-01T00:00:00.000Z",
    status: "available",
    perUserLimit: undefined,
    ...overrides,
  });
}

describe("updateSettlementValue", () => {
  it("changes settlement_value_idr but leaves price_in_points exactly as it was", async () => {
    const listing = await createListing();
    const requestedBy = "00000000-0000-4000-8000-0000000c0001";

    const change = await repo.updateSettlementValue(
      MERCHANT,
      listing.id,
      2_000_000,
      requestedBy,
      "Merchant requested a lower settlement rate for the holiday promo.",
    );

    expect(change).not.toBeNull();
    expect(change?.previous.settlementValueIdr).toBe(3_000_000);
    expect(change?.updated.settlementValueIdr).toBe(2_000_000);
    // THE invariant: this module cannot compute a real points price, so it
    // must not silently invent one.
    expect(change?.updated.priceInPoints).toBe(listing.priceInPoints);
  });

  it("writes exactly one audit row per call, with newPriceInPoints left null", async () => {
    const listing = await createListing();
    const requestedBy = "00000000-0000-4000-8000-0000000c0002";

    await repo.updateSettlementValue(MERCHANT, listing.id, 1_000_000, requestedBy, "First cut.");
    await repo.updateSettlementValue(MERCHANT, listing.id, 500_000, requestedBy, "Second cut.");

    const trail = await revisions.listForListing(listing.id);
    expect(trail).toHaveLength(2);
    for (const entry of trail) {
      expect(entry.newPriceInPoints).toBeNull();
      expect(entry.requestedBy).toBe(requestedBy);
    }
    const [latest, earliest] = trail;
    expect(latest?.newSettlementValueIdr).toBe(500_000);
    expect(latest?.previousSettlementValueIdr).toBe(1_000_000);
    expect(earliest?.newSettlementValueIdr).toBe(1_000_000);
    expect(earliest?.previousSettlementValueIdr).toBe(3_000_000);
  });

  it("returns null and writes nothing for a listing outside the caller's tenant", async () => {
    const listing = await createListing();
    const otherMerchant = "00000000-0000-4000-8000-0000000b0002";

    const change = await repo.updateSettlementValue(
      otherMerchant,
      listing.id,
      1,
      "00000000-0000-4000-8000-0000000c0003",
      "Should not apply.",
    );

    expect(change).toBeNull();
    expect(await revisions.listForListing(listing.id)).toHaveLength(0);
    const unchanged = await repo.findOwnedById(MERCHANT, listing.id);
    expect(unchanged?.settlementValueIdr).toBe(3_000_000);
  });
});

describe("updateFields never touches price or lifecycle", () => {
  it("edits stock and description without moving settlementValueIdr or priceInPoints", async () => {
    const listing = await createListing();
    const updated = await repo.updateFields(MERCHANT, listing.id, {
      description: "Updated description text.",
      stockTotal: 20,
    });

    expect(updated?.description).toBe("Updated description text.");
    expect(updated?.stockTotal).toBe(20);
    expect(updated?.settlementValueIdr).toBe(listing.settlementValueIdr);
    expect(updated?.priceInPoints).toBe(listing.priceInPoints);
  });
});
