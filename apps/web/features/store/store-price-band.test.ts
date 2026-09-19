import { describe, expect, it } from "vitest";
import type { Listing } from "@yourtal/contracts/listing";
import { soldOutListingFixture } from "@yourtal/contracts/listing/mock";
import { toPoints } from "@yourtal/contracts/money";
import {
  STORE_PRICE_BAND_FILTER_VALUES,
  filterListingsByPriceBand,
  isStorePriceBandFilter,
} from "./store-price-band";

function listingWithPrice(id: string, priceInPoints: number): Listing {
  return { ...soldOutListingFixture, id, priceInPoints: toPoints(priceInPoints) };
}

const cheap = listingWithPrice("11111111-1111-4111-8111-111111111111", 1_000);
const mid = listingWithPrice("22222222-2222-4222-8222-222222222222", 3_000);
const upper = listingWithPrice("33333333-3333-4333-8333-333333333333", 7_500);
const expensive = listingWithPrice("44444444-4444-4444-8444-444444444444", 20_000);

describe("filterListingsByPriceBand", () => {
  const listings = [cheap, mid, upper, expensive];

  it("returns every listing for 'all'", () => {
    expect(filterListingsByPriceBand(listings, "all")).toEqual(listings);
  });

  it("keeps only listings under 2,500 points", () => {
    expect(filterListingsByPriceBand(listings, "under_2500")).toEqual([cheap]);
  });

  it("keeps only listings in the 2,500-5,000 band", () => {
    expect(filterListingsByPriceBand(listings, "2500_5000")).toEqual([mid]);
  });

  it("keeps only listings in the 5,000-10,000 band", () => {
    expect(filterListingsByPriceBand(listings, "5000_10000")).toEqual([upper]);
  });

  it("keeps only listings above 10,000 points, with no upper bound", () => {
    expect(filterListingsByPriceBand(listings, "over_10000")).toEqual([expensive]);
  });

  it("treats band boundaries as [min, max)", () => {
    const atBoundary = listingWithPrice("55555555-5555-4555-8555-555555555555", 2_500);
    expect(filterListingsByPriceBand([atBoundary], "under_2500")).toEqual([]);
    expect(filterListingsByPriceBand([atBoundary], "2500_5000")).toEqual([atBoundary]);
  });
});

describe("isStorePriceBandFilter", () => {
  it("accepts every declared filter value", () => {
    for (const value of STORE_PRICE_BAND_FILTER_VALUES) {
      expect(isStorePriceBandFilter(value)).toBe(true);
    }
  });

  it("rejects an arbitrary string", () => {
    expect(isStorePriceBandFilter("free")).toBe(false);
  });
});
