import { describe, expect, it } from "vitest";
import type { ListingRow } from "./listing-assembler";
import { listingFacets, matchesFacets, pageAfter, sortRows } from "./listing-browse-facets";

function row(id: string, overrides: Partial<ListingRow>): ListingRow {
  return {
    id,
    merchantId: "m1",
    merchantName: "Brand One",
    category: "food_beverage",
    tags: [],
    priceInPoints: 100,
    stockTotal: 10,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    expiresAt: new Date("2026-12-01T00:00:00Z"),
    ...overrides,
  } as ListingRow;
}

describe("store browse facets (13.12.b)", () => {
  const a = row("a", { tags: ["coffee"], priceInPoints: 300 });
  const b = row("b", {
    merchantId: "m2",
    merchantName: "Brand Two",
    category: "retail",
    tags: ["fashion"],
    priceInPoints: 100,
  });
  const c = row("c", {
    tags: ["coffee", "bakery"],
    priceInPoints: 200,
    createdAt: new Date("2026-09-20T00:00:00Z"),
    expiresAt: new Date("2026-10-01T00:00:00Z"),
  });
  const rows = [a, b, c];

  it("filters by category, brand and any-of tags together", () => {
    expect(rows.filter((r) => matchesFacets(r, { tags: ["bakery", "fashion"] }))).toEqual([b, c]);
    expect(rows.filter((r) => matchesFacets(r, { brands: ["m2"] }))).toEqual([b]);
    expect(
      rows.filter((r) => matchesFacets(r, { category: "food_beverage", tags: ["fashion"] })),
    ).toEqual([]);
  });

  it("counts each facet without its own filter", () => {
    const facets = listingFacets(rows, { brands: ["m1"] });
    expect(facets.brands).toEqual([
      { value: "m1", count: 2, label: "Brand One" },
      { value: "m2", count: 1, label: "Brand Two" },
    ]);
    expect(facets.categories).toEqual([{ value: "food_beverage", count: 2 }]);
    expect(facets.tags).toEqual([
      { value: "coffee", count: 2 },
      { value: "bakery", count: 1 },
    ]);
  });

  it("sorts by points both ways, newest, ending soon and popular", () => {
    const values = {
      priceOf: (r: ListingRow) => r.priceInPoints,
      takenOf: (r: ListingRow) => (r.id === "b" ? 7 : 1),
    };
    const ids = (s: Parameters<typeof sortRows>[1]) => sortRows(rows, s, values).map((r) => r.id);
    expect(ids("points_asc")).toEqual(["b", "c", "a"]);
    expect(ids("points_desc")).toEqual(["a", "c", "b"]);
    expect(ids("newest")[0]).toBe("c");
    expect(ids("ending_soon")[0]).toBe("c");
    expect(ids("popular")).toEqual(["b", "a", "c"]);
  });

  it("pages after a cursor in the sorted order", () => {
    expect(pageAfter(rows, undefined, 2)).toEqual({ page: [a, b], hasMore: true });
    expect(pageAfter(rows, "b", 2)).toEqual({ page: [c], hasMore: false });
    expect(pageAfter(rows, "gone", 2)).toEqual({ page: [], hasMore: false });
  });
});
