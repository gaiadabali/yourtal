import { describe, expect, it } from "vitest";
import type { Listing } from "@yourtal/contracts/listing";
import { soldOutListingFixture } from "@yourtal/contracts/listing/mock";
import {
  STORE_CATEGORY_FILTER_VALUES,
  categoryLabel,
  filterListingsByCategory,
  isStoreCategoryFilter,
} from "./store-category";

const foodListing: Listing = {
  ...soldOutListingFixture,
  id: "11111111-1111-4111-8111-111111111111",
  category: "food_beverage",
};
const retailListing: Listing = {
  ...soldOutListingFixture,
  id: "22222222-2222-4222-8222-222222222222",
  category: "retail",
};

describe("filterListingsByCategory", () => {
  it("returns every listing, unmutated order, for 'all'", () => {
    expect(filterListingsByCategory([foodListing, retailListing], "all")).toEqual([
      foodListing,
      retailListing,
    ]);
  });

  it("keeps only listings matching the given category", () => {
    expect(filterListingsByCategory([foodListing, retailListing], "retail")).toEqual([
      retailListing,
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [foodListing, retailListing];
    const copy = [...input];
    filterListingsByCategory(input, "retail");
    expect(input).toEqual(copy);
  });
});

describe("isStoreCategoryFilter", () => {
  it("accepts every declared filter value", () => {
    for (const value of STORE_CATEGORY_FILTER_VALUES) {
      expect(isStoreCategoryFilter(value)).toBe(true);
    }
  });

  it("rejects an arbitrary string", () => {
    expect(isStoreCategoryFilter("groceries")).toBe(false);
  });
});

describe("categoryLabel", () => {
  it("returns an Indonesian label for every real category (id-ID)", () => {
    expect(categoryLabel("food_beverage", "id-ID")).toBe("Makanan & Minuman");
    expect(categoryLabel("digital_goods", "id-ID")).toBe("Produk Digital");
  });

  it("returns an English label for every real category (en-AU, YT-0405)", () => {
    expect(categoryLabel("food_beverage", "en-AU")).toBe("Food & Beverage");
    expect(categoryLabel("digital_goods", "en-AU")).toBe("Digital Goods");
  });
});
