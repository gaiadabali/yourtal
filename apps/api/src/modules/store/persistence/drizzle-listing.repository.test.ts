import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { DrizzleListingRepository } from "./drizzle-listing.repository";
import { clearStoreTables, testStoreDb } from "./store-db.test-helper";
import { merchantLocations } from "./schema/listing.table";
import type { CreateListingInput } from "./listing.repository";

/**
 * `store.listings`, `store.merchant_location` and `store.listing_location`,
 * against real Postgres. YT-0130/YT-0131/YT-0132 backend.
 */
const db = testStoreDb();
const repo = new DrizzleListingRepository(db);

beforeAll(async () => {
  await clearStoreTables(db);
});

const MERCHANT_A = "00000000-0000-4000-8000-0000000a0001";
const MERCHANT_B = "00000000-0000-4000-8000-0000000a0002";

async function seedLocation(merchantId: string, district = "Kemang"): Promise<string> {
  const [row] = await db
    .insert(merchantLocations)
    .values({
      id: randomUUID(),
      merchantId,
      name: "Test Outlet",
      address: "Jl. Test No. 1",
      district,
    })
    .returning();
  if (row === undefined) throw new Error("failed to seed a merchant_location row");
  return row.id;
}

function baseInput(overrides: Partial<CreateListingInput> = {}): CreateListingInput {
  return {
    merchantName: "Kopi Kenangan Test",
    title: "Voucher Kopi Test",
    description: "A test voucher for the store module's own test suite.",
    category: "food_beverage",
    locationIds: [],
    currency: "IDR" as const,
    faceValueMinor: 50_000,
    settlementValueMinor: 15_000,
    priceInPoints: 2_500,
    stockTotal: 10,
    transferable: false,
    partialRedemptionPolicy: "single_use_forfeit",
    minimumSpendMinor: null,
    expiresAt: "2027-01-01T00:00:00.000Z",
    status: "available",
    perUserLimit: undefined,
    region: "ID",
    audience: "all_ages",
    contentCategory: "food-and-drink",
    imageUrl: "https://cdn.example.com/listing.jpg",
    channel: "in_store",
    partialRedemption: "single_use",
    ...overrides,
  };
}

describe("locationsBelongToMerchant", () => {
  it("is true only when every id belongs to the named merchant", async () => {
    const locationId = await seedLocation(MERCHANT_A);
    expect(await repo.locationsBelongToMerchant(MERCHANT_A, [locationId])).toBe(true);
    expect(await repo.locationsBelongToMerchant(MERCHANT_B, [locationId])).toBe(false);
  });

  it("is false for an empty list -- listingSchema requires at least one location", async () => {
    expect(await repo.locationsBelongToMerchant(MERCHANT_A, [])).toBe(false);
  });

  it("is false when only some ids belong to the merchant", async () => {
    const own = await seedLocation(MERCHANT_A);
    const someoneElses = await seedLocation(MERCHANT_B);
    expect(await repo.locationsBelongToMerchant(MERCHANT_A, [own, someoneElses])).toBe(false);
  });
});

describe("create + read round trip", () => {
  it("creates a listing that round-trips through listingSchema with its locations joined", async () => {
    const locationId = await seedLocation(MERCHANT_A, "Senopati");
    const created = await repo.create(MERCHANT_A, baseInput({ locationIds: [locationId] }));

    expect(created.merchantId).toBe(MERCHANT_A);
    expect(created.locations).toHaveLength(1);
    expect(created.locations[0]?.district).toBe("Senopati");
    expect(created.stockRemaining).toBe(created.stockTotal);
    expect(created.perUserLimit).toBeUndefined();

    const found = await repo.findOwnedById(MERCHANT_A, created.id);
    expect(found).toStrictEqual(created);
  });

  it("stores an explicit perUserLimit and rejects a zero-or-negative one at the contract boundary", async () => {
    const locationId = await seedLocation(MERCHANT_A);
    const created = await repo.create(
      MERCHANT_A,
      baseInput({ locationIds: [locationId], perUserLimit: 2 }),
    );
    expect(created.perUserLimit).toBe(2);
  });

  it("a listing belonging to another merchant is invisible to findOwnedById", async () => {
    const locationId = await seedLocation(MERCHANT_A);
    const created = await repo.create(MERCHANT_A, baseInput({ locationIds: [locationId] }));
    expect(await repo.findOwnedById(MERCHANT_B, created.id)).toBeNull();
  });

  it("findOwnedById returns null for a listing that does not exist", async () => {
    expect(await repo.findOwnedById(MERCHANT_A, randomUUID())).toBeNull();
  });
});

describe("public visibility follows lifecycle_state, not existence", () => {
  it("a freshly created listing is immediately public (active by default)", async () => {
    const locationId = await seedLocation(MERCHANT_A);
    const created = await repo.create(MERCHANT_A, baseInput({ locationIds: [locationId] }));

    // The public view is the merchant view MINUS settlementValueMinor, and this
    // used to read `toStrictEqual(created)` -- which passed precisely because
    // S was being served to anonymous callers (docs/24 ID-1: S beside
    // priceInPoints publishes the backing rate B by arithmetic).
    const { settlementValueMinor: _merchantOnly, ...publicView } = created;
    const found = await repo.findPublicById(created.id);
    expect(found).toStrictEqual(publicView);
    expect(found).not.toHaveProperty("settlementValueMinor");
  });

  it("a paused listing disappears from the public catalogue but stays visible to its owner", async () => {
    const locationId = await seedLocation(MERCHANT_A);
    const created = await repo.create(MERCHANT_A, baseInput({ locationIds: [locationId] }));

    const paused = await repo.setLifecycleState(MERCHANT_A, created.id, "paused");
    expect(paused).not.toBeNull();

    expect(await repo.findPublicById(created.id)).toBeNull();
    expect(await repo.findOwnedById(MERCHANT_A, created.id)).not.toBeNull();
  });

  it("a retired listing never reappears publicly, and browsePublic excludes it", async () => {
    const locationId = await seedLocation(MERCHANT_A);
    const created = await repo.create(MERCHANT_A, baseInput({ locationIds: [locationId] }));
    await repo.setLifecycleState(MERCHANT_A, created.id, "retired");

    expect(await repo.findPublicById(created.id)).toBeNull();
    const page = await repo.browsePublic({ limit: 100 });
    expect(page.listings.some((listing) => listing.id === created.id)).toBe(false);
  });
});
