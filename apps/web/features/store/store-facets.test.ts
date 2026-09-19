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
  locations: [
    {
      id: "aaaa1111-1111-4111-8111-111111111111",
      name: "Zeta Kopi Menteng",
      address: "Jl. Menteng Raya 1",
      district: "Menteng",
    },
  ],
};
const b: Listing = {
  ...soldOutListingFixture,
  id: "22222222-2222-4222-8222-222222222222",
  merchantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  merchantName: "Ayam Berkah",
  locations: [
    {
      id: "bbbb1111-1111-4111-8111-111111111111",
      name: "Ayam Berkah Kemang",
      address: "Jl. Kemang Raya 2",
      district: "Kemang",
    },
  ],
};
const c: Listing = {
  ...soldOutListingFixture,
  id: "33333333-3333-4333-8333-333333333333",
  merchantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  merchantName: "Zeta Kopi",
  locations: [
    {
      id: "aaaa2222-2222-4222-8222-222222222222",
      name: "Zeta Kopi Menteng 2",
      address: "Jl. Menteng Raya 9",
      district: "Menteng",
    },
  ],
};

/**
 * A multi-branch listing, which the old single `district: string` field could
 * not express at all. It exists so the two behaviours that field silently got
 * wrong stay pinned: this listing must contribute BOTH districts to the facet
 * options, and must be returned when filtering by EITHER of them.
 */
const multiBranch: Listing = {
  ...soldOutListingFixture,
  id: "44444444-4444-4444-8444-444444444444",
  merchantId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  merchantName: "Roti Dua Cabang",
  locations: [
    {
      id: "cccc1111-1111-4111-8111-111111111111",
      name: "Roti Senayan",
      address: "Jl. Senayan 5",
      district: "Senayan",
    },
    {
      id: "cccc2222-2222-4222-8222-222222222222",
      name: "Roti Kemang",
      address: "Jl. Kemang Raya 7",
      district: "Kemang",
    },
  ],
};

describe("listingLocations", () => {
  it("deduplicates and alphabetises districts", () => {
    expect(listingLocations([a, b, c])).toEqual(["Kemang", "Menteng"]);
  });

  it("offers every district a multi-branch listing reaches, not just its first", () => {
    expect(listingLocations([multiBranch])).toEqual(["Kemang", "Senayan"]);
  });
});

describe("filterListingsByLocation with multi-branch listings", () => {
  it("returns a listing under each district it has a branch in", () => {
    expect(filterListingsByLocation([a, multiBranch], "Senayan")).toEqual([multiBranch]);
    expect(filterListingsByLocation([a, multiBranch], "Kemang")).toEqual([multiBranch]);
  });

  it("does not return it for a district it has no branch in", () => {
    expect(filterListingsByLocation([multiBranch], "Menteng")).toEqual([]);
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
