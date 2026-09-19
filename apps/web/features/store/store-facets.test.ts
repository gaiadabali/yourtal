import { describe, expect, it } from "vitest";
import type { Listing } from "@yourtal/contracts/listing";
import { soldOutListingFixture } from "@yourtal/contracts/listing/mock";
import {
  STORE_LOCATION_ALL,
  STORE_MERCHANT_ALL,
  filterListingsByLocation,
  filterListingsByMerchant,
  listingLocations,
  listingMerchants,
} from "./store-facets";

const a: Listing = {
  ...soldOutListingFixture,
  id: "11111111-1111-4111-8111-111111111111",
  merchantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  merchantName: "Zeta Kopi",
  district: "Menteng",
};
const b: Listing = {
  ...soldOutListingFixture,
  id: "22222222-2222-4222-8222-222222222222",
  merchantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  merchantName: "Ayam Berkah",
  district: "Kemang",
};
const c: Listing = {
  ...soldOutListingFixture,
  id: "33333333-3333-4333-8333-333333333333",
  merchantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  merchantName: "Zeta Kopi",
  district: "Menteng",
};

describe("listingLocations", () => {
  it("deduplicates and alphabetises districts", () => {
    expect(listingLocations([a, b, c])).toEqual(["Kemang", "Menteng"]);
  });
});

describe("listingMerchants", () => {
  it("deduplicates by merchant id and alphabetises by name", () => {
    expect(listingMerchants([a, b, c])).toEqual([
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Ayam Berkah" },
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Zeta Kopi" },
    ]);
  });
});

describe("filterListingsByLocation", () => {
  it("returns every listing for the 'all' sentinel", () => {
    expect(filterListingsByLocation([a, b], STORE_LOCATION_ALL)).toEqual([a, b]);
  });

  it("keeps only listings in the given district", () => {
    expect(filterListingsByLocation([a, b], "Kemang")).toEqual([b]);
  });
});

describe("filterListingsByMerchant", () => {
  it("returns every listing for the 'all' sentinel", () => {
    expect(filterListingsByMerchant([a, b], STORE_MERCHANT_ALL)).toEqual([a, b]);
  });

  it("keeps only listings from the given merchant id", () => {
    expect(filterListingsByMerchant([a, b, c], "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toEqual([
      a,
      c,
    ]);
  });
});
