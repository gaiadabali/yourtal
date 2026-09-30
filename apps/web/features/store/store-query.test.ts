import { describe, expect, it } from "vitest";
import {
  EMPTY_STORE_QUERY,
  activeFilterCount,
  listingsApiPath,
  parseStoreQuery,
  storeHref,
  withFilters,
} from "./store-query";

const BRAND = "00000000-0000-4000-9000-000000000001";

describe("store query (13.15.a)", () => {
  it("keeps known filters and drops the rest", () => {
    const query = parseStoreQuery({
      q: " coffee ",
      category: "food_beverage",
      where: "in_store",
      brand: `${BRAND},not-a-uuid`,
      tags: "coffee,nope",
      min: "900",
      max: "100",
      sort: "points_asc",
      after: "junk",
    });
    expect(query).toStrictEqual({
      ...EMPTY_STORE_QUERY,
      q: "coffee",
      category: "food_beverage",
      where: "in_store",
      brands: [BRAND],
      tags: ["coffee"],
      minPoints: 100,
      maxPoints: 900,
      sort: "points_asc",
    });
    expect(parseStoreQuery({ where: "both", sort: "cheapest" })).toStrictEqual(EMPTY_STORE_QUERY);
  });

  it("round-trips through the URL and restarts paging on a filter change", () => {
    const query = {
      ...EMPTY_STORE_QUERY,
      where: "online" as const,
      tags: ["coffee"],
      after: BRAND,
    };
    const back = parseStoreQuery(
      Object.fromEntries(new URL(storeHref(query), "http://x").searchParams),
    );
    expect(back).toStrictEqual(query);
    expect(withFilters(query, { tags: [] }).after).toBeNull();
    expect(storeHref(EMPTY_STORE_QUERY)).toBe("/store");
    expect(activeFilterCount(query)).toBe(2);
  });

  it("maps the URL onto the API's own param names", () => {
    const path = listingsApiPath(
      { ...EMPTY_STORE_QUERY, minPoints: 10, location: "Kemang", after: BRAND },
      24,
      BRAND,
    );
    expect(path).toContain("minPoints=10");
    expect(path).toContain("district=Kemang");
    expect(path).toContain(`startingAfter=${BRAND}`);
    expect(path).toContain(`merchantId=${BRAND}`);
    expect(path).not.toContain("where");
  });
});
