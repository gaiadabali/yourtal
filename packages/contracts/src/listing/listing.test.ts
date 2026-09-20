import { describe, expect, it } from "vitest";
import { listingSchema } from "./listing";
import {
  abovePlausibleBalanceListingFixture,
  expiringSoonListingFixture,
  generateListing,
  generateListings,
  mockListings,
  soldOutListingFixture,
} from "./listing.mock";

const validListing = {
  id: "11111111-1111-4111-8111-111111111111",
  merchantId: "22222222-2222-4222-8222-222222222222",
  merchantName: "Toko Berkah",
  title: "Voucher Toko Berkah Rp50.000",
  description: "Voucher belanja di seluruh cabang Toko Berkah.",
  category: "retail",
  locations: [
    {
      id: "55555555-5555-4555-8555-555555555555",
      name: "Toko Berkah — Cabang Utama",
      address: "Jl. Kartini No. 5, Tebet",
      district: "Tebet",
    },
  ],
  faceValueIdr: 50_000,
  settlementValueIdr: 15_000,
  priceInPoints: 2_500,
  stockRemaining: 10,
  stockTotal: 20,
  transferable: true,
  partialRedemptionPolicy: "balance_carrying",
  minimumSpendIdr: null,
  expiresAt: "2026-12-01T00:00:00.000Z",
  status: "available",
};

describe("listingSchema", () => {
  it("round-trips a valid listing", () => {
    const parsed = listingSchema.parse(validListing);
    expect(parsed).toMatchObject({ title: validListing.title, priceInPoints: 2_500 });
  });

  it("round-trips without perUserLimit (undefined means no limit)", () => {
    const parsed = listingSchema.parse(validListing);
    expect(parsed.perUserLimit).toBeUndefined();
  });

  it("round-trips a valid perUserLimit", () => {
    const parsed = listingSchema.parse({ ...validListing, perUserLimit: 2 });
    expect(parsed.perUserLimit).toBe(2);
  });

  it("rejects a zero perUserLimit", () => {
    expect(listingSchema.safeParse({ ...validListing, perUserLimit: 0 }).success).toBe(false);
  });

  it("rejects a negative perUserLimit", () => {
    expect(listingSchema.safeParse({ ...validListing, perUserLimit: -1 }).success).toBe(false);
  });

  const rejectionTable: Array<{ name: string; overrides: Record<string, unknown> }> = [
    { name: "negative face value", overrides: { faceValueIdr: -1 } },
    { name: "negative price in points", overrides: { priceInPoints: -1 } },
    { name: "invalid category enum value", overrides: { category: "gambling" } },
    { name: "invalid status enum value", overrides: { status: "hidden" } },
    {
      name: "invalid partial redemption policy enum value",
      overrides: { partialRedemptionPolicy: "full_refund" },
    },
    {
      name: "stockRemaining greater than stockTotal",
      overrides: { stockRemaining: 25, stockTotal: 20 },
    },
    {
      name: "settlementValue greater than faceValue",
      overrides: { settlementValueIdr: 60_000, faceValueIdr: 50_000 },
    },
    {
      name: "sold_out status with remaining stock",
      overrides: { status: "sold_out", stockRemaining: 5 },
    },
    {
      name: "minimum_spend policy without a minimum spend amount",
      overrides: { partialRedemptionPolicy: "minimum_spend", minimumSpendIdr: null },
    },
    {
      name: "non-minimum_spend policy with a minimum spend amount set",
      overrides: { partialRedemptionPolicy: "balance_carrying", minimumSpendIdr: 10_000 },
    },
    { name: "zero stockTotal", overrides: { stockTotal: 0 } },
    { name: "non-datetime expiresAt", overrides: { expiresAt: "next week" } },
    { name: "non-uuid id", overrides: { id: "abc" } },
    { name: "empty locations array", overrides: { locations: [] } },
    {
      name: "duplicate location ids",
      overrides: {
        locations: [validListing.locations[0], validListing.locations[0]],
      },
    },
    {
      name: "a location missing an address",
      overrides: { locations: [{ ...validListing.locations[0], address: "" }] },
    },
  ];

  it.each(rejectionTable)("rejects $name", ({ overrides }) => {
    const candidate = { ...validListing, ...overrides };
    expect(listingSchema.safeParse(candidate).success).toBe(false);
  });
});

describe("generateListing determinism", () => {
  it("produces byte-identical output for the same seed and reference instant", () => {
    const now = new Date("2026-09-19T09:00:00.000Z");
    const first = generateListing({ seed: 7, now });
    const second = generateListing({ seed: 7, now });
    expect(first).toStrictEqual(second);
  });

  it("generates a batch that is itself deterministic", () => {
    expect(generateListings(30, 2_000)).toStrictEqual(mockListings);
  });
});

describe("awkward fixtures", () => {
  it("the sold-out fixture has zero remaining stock", () => {
    expect(soldOutListingFixture.stockRemaining).toBe(0);
    expect(soldOutListingFixture.status).toBe("sold_out");
  });

  it("the above-plausible-balance fixture is priced far beyond a realistic wallet balance", () => {
    // realistic mock balances top out at 25,000 points (see balance.mock.ts)
    expect(abovePlausibleBalanceListingFixture.priceInPoints).toBeGreaterThan(25_000);
  });

  it("the expiring-soon fixture expires within a few hours of the reference instant", () => {
    const referenceInstant = new Date("2026-09-19T09:00:00.000Z");
    const expiresAt = new Date(expiringSoonListingFixture.expiresAt);
    const hoursUntilExpiry = (expiresAt.getTime() - referenceInstant.getTime()) / (1_000 * 60 * 60);
    expect(hoursUntilExpiry).toBeLessThan(24);
    expect(hoursUntilExpiry).toBeGreaterThan(0);
  });
});
