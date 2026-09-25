import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { DrizzleListingRepository } from "./drizzle-listing.repository";
import { clearStoreTables, testStoreDb } from "./store-db.test-helper";
import { merchantLocations } from "./schema/listing.table";
import type { CreateListingInput } from "./listing.repository";

/** Filtering by category, merchant, price band and district; full-text search; cursor paging. */
const db = testStoreDb();
const repo = new DrizzleListingRepository(db);

const MERCHANT_COFFEE = "00000000-0000-4000-8000-0000000d0001";
const MERCHANT_RETAIL = "00000000-0000-4000-8000-0000000d0002";

beforeAll(async () => {
  await clearStoreTables(db);
});

async function seededListing(
  merchantId: string,
  overrides: Partial<CreateListingInput> & { district?: string },
) {
  const { district = "Kemang", ...rest } = overrides;
  const [location] = await db
    .insert(merchantLocations)
    .values({ id: randomUUID(), merchantId, name: "Outlet", address: "Jl. Test", district })
    .returning();
  if (location === undefined) throw new Error("failed to seed a merchant_location row");

  return repo.create(merchantId, {
    merchantName: "Browse Test Merchant",
    title: "Default Title",
    description: "Default description.",
    category: "food_beverage",
    locationIds: [location.id],
    currency: "IDR" as const,
    faceValueMinor: 10_000,
    settlementValueMinor: 3_000,
    priceInPoints: 500,
    stockTotal: 10,
    transferable: false,
    partialRedemptionPolicy: "single_use_forfeit",
    minimumSpendMinor: null,
    expiresAt: "2027-01-01T00:00:00.000Z",
    status: "available",
    perUserLimit: undefined,
    ...rest,
  });
}

describe("browsePublic filters", () => {
  it("filters by category", async () => {
    const coffee = await seededListing(MERCHANT_COFFEE, { category: "food_beverage" });
    const retail = await seededListing(MERCHANT_RETAIL, { category: "retail" });

    const page = await repo.browsePublic({ category: "retail", limit: 100 });
    const ids = page.listings.map((listing) => listing.id);
    expect(ids).toContain(retail.id);
    expect(ids).not.toContain(coffee.id);
  });

  it("filters by merchant", async () => {
    const mine = await seededListing(MERCHANT_COFFEE, { category: "digital_goods" });
    const page = await repo.browsePublic({ merchantId: MERCHANT_COFFEE, limit: 100 });
    expect(page.listings.every((listing) => listing.merchantId === MERCHANT_COFFEE)).toBe(true);
    expect(page.listings.some((listing) => listing.id === mine.id)).toBe(true);
  });

  it("filters by a price band (minPoints/maxPoints)", async () => {
    const cheap = await seededListing(MERCHANT_COFFEE, { priceInPoints: 100 });
    const pricey = await seededListing(MERCHANT_COFFEE, { priceInPoints: 9_000 });

    const page = await repo.browsePublic({ minPoints: 5_000, maxPoints: 10_000, limit: 100 });
    const ids = page.listings.map((listing) => listing.id);
    expect(ids).toContain(pricey.id);
    expect(ids).not.toContain(cheap.id);
  });

  it("filters by district through the joined location", async () => {
    const senopati = await seededListing(MERCHANT_RETAIL, { district: "Senopati" });
    const kemang = await seededListing(MERCHANT_RETAIL, { district: "Kemang" });

    const page = await repo.browsePublic({ district: "Senopati", limit: 100 });
    const ids = page.listings.map((listing) => listing.id);
    expect(ids).toContain(senopati.id);
    expect(ids).not.toContain(kemang.id);
  });

  it("full-text searches title and description", async () => {
    const match = await seededListing(MERCHANT_COFFEE, {
      title: "Kopi Susu Gula Aren Spesial",
      description: "Minuman kopi kekinian.",
    });
    const noMatch = await seededListing(MERCHANT_COFFEE, {
      title: "Voucher Belanja Elektronik",
      description: "Diskon untuk pembelian gadget.",
    });

    const page = await repo.browsePublic({ search: "Kopi", limit: 100 });
    const ids = page.listings.map((listing) => listing.id);
    expect(ids).toContain(match.id);
    expect(ids).not.toContain(noMatch.id);
  });

  // ID-1 (docs/24) is the single largest legal exposure in the plan: points
  // are a loyalty currency and not e-money BECAUSE, among four things, there
  // is "no published fixed cash rate". The catalogue is @PublicRoute and
  // unauthenticated.
  //
  // priceInPoints MUST be public -- it is what the user pays. So publishing
  // settlementValueMinor next to it publishes the backing rate by arithmetic:
  // points_price = (S / B) x demand_multiplier, and the multiplier is pinned
  // at 1.0 for launch (YT-0130), so B = S / priceInPoints exactly. Not an
  // approximation, and not recoverable only in aggregate -- one row is enough.
  //
  // faceValueMinor stays public deliberately: it is the voucher's retail value,
  // the thing a shopper is entitled to compare against, and it reveals a
  // discount rather than what the platform holds per point.
  it("never exposes settlementValueMinor -- S with priceInPoints publishes B (ID-1)", async () => {
    await seededListing(MERCHANT_COFFEE, { title: "Rate leak probe" });

    const page = await repo.browsePublic({ limit: 100 });
    expect(page.listings.length).toBeGreaterThan(0);
    for (const listing of page.listings) {
      expect(listing).not.toHaveProperty("settlementValueMinor");
    }
  });

  it("paginates with a cursor and reports hasMore honestly", async () => {
    for (let index = 0; index < 3; index += 1) {
      await seededListing(MERCHANT_RETAIL, { title: `Cursor Listing ${String(index)}` });
    }

    const firstPage = await repo.browsePublic({ merchantId: MERCHANT_RETAIL, limit: 1 });
    expect(firstPage.listings).toHaveLength(1);
    expect(firstPage.hasMore).toBe(true);

    const cursor = firstPage.listings[0]?.id;
    const secondPage = await repo.browsePublic({
      merchantId: MERCHANT_RETAIL,
      limit: 1,
      startingAfter: cursor,
    });
    expect(secondPage.listings[0]?.id).not.toBe(cursor);
  });
});
