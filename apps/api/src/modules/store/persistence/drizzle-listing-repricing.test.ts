import { randomUUID } from "node:crypto";
import { stubLedgerClient } from "./test-ledger-stub";
import { beforeAll, describe, expect, it } from "vitest";
import { DrizzleListingPriceRevisionRepository } from "./drizzle-listing-price-revision.repository";
import { DrizzleListingRepository } from "./drizzle-listing.repository";
import { clearStoreTables, testStoreDb } from "./store-db.test-helper";
import { merchantLocations } from "./schema/listing.table";
import type { CreateListingInput } from "./listing.repository";

/**
 * The one operation this ticket calls out by name: changing a listing's
 * settlement value `S` must be audit-logged (docs/17 section 2.1), and
 * (since 7.4.b) DOES reprice `price_in_points` -- through the ledger's
 * `priceListing`, never recomputed by this module itself. `stubLedgerClient`
 * is the real `FakeLedgerClient` (every migrated database, including a
 * fresh test one, seeds F1's default ID rate of 6,000,000 micros/pt), so
 * `priceInPoints = ceil(settlementMinor * 1e6 / 6_000_000) = ceil(settlementMinor / 6)`.
 */
const db = testStoreDb();
const repo = new DrizzleListingRepository(db, stubLedgerClient(db));
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
    currency: "IDR" as const,
    faceValueMinor: 100_000,
    settlementValueMinor: 30_000,
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
    ...overrides,
  });
}

describe("updateSettlementValue", () => {
  it("changes settlement_value_minor and reprices price_in_points via the ledger", async () => {
    const listing = await createListing();
    const requestedBy = "00000000-0000-4000-8000-0000000c0001";
    expect(listing.priceInPoints).toBe(5_000); // 30_000 / 6, exactly

    const change = await repo.updateSettlementValue(
      MERCHANT,
      listing.id,
      20_000,
      requestedBy,
      "Merchant requested a lower settlement rate for the holiday promo.",
    );

    expect(change).not.toBeNull();
    expect(change?.previous.settlementValueMinor).toBe(30_000);
    expect(change?.updated.settlementValueMinor).toBe(20_000);
    // THE invariant this ticket names: the price is NOT left as it was --
    // it comes from a fresh call to the ledger, every time S changes.
    expect(change?.updated.priceInPoints).toBe(Math.ceil(20_000 / 6));
  });

  it("writes exactly one audit row per call, with newPriceInPoints set from the ledger", async () => {
    const listing = await createListing();
    const requestedBy = "00000000-0000-4000-8000-0000000c0002";

    await repo.updateSettlementValue(MERCHANT, listing.id, 10_000, requestedBy, "First cut.");
    await repo.updateSettlementValue(MERCHANT, listing.id, 5_000, requestedBy, "Second cut.");

    const trail = await revisions.listForListing(listing.id);
    expect(trail).toHaveLength(2);
    for (const entry of trail) {
      expect(entry.requestedBy).toBe(requestedBy);
    }
    const [latest, earliest] = trail;
    expect(latest?.newSettlementValueMinor).toBe(5_000);
    expect(latest?.newPriceInPoints).toBe(Math.ceil(5_000 / 6));
    expect(latest?.previousSettlementValueMinor).toBe(10_000);
    expect(earliest?.newSettlementValueMinor).toBe(10_000);
    expect(earliest?.newPriceInPoints).toBe(Math.ceil(10_000 / 6));
    expect(earliest?.previousSettlementValueMinor).toBe(30_000);
    expect(listing.priceInPoints).toBe(5_000);
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
    expect(unchanged?.settlementValueMinor).toBe(30_000);
  });
});

describe("updateFields never touches price or lifecycle", () => {
  it("edits stock and description without moving settlementValueMinor or priceInPoints", async () => {
    const listing = await createListing();
    const updated = await repo.updateFields(MERCHANT, listing.id, {
      description: "Updated description text.",
      stockTotal: 20,
    });

    expect(updated?.description).toBe("Updated description text.");
    expect(updated?.stockTotal).toBe(20);
    expect(updated?.settlementValueMinor).toBe(listing.settlementValueMinor);
    expect(updated?.priceInPoints).toBe(listing.priceInPoints);
  });
});
