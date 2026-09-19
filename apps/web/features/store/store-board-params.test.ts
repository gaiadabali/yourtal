import { describe, expect, it } from "vitest";
import {
  buildStoreBoardQuery,
  hasActiveStoreFilters,
  parseStoreBoardParams,
} from "./store-board-params";

describe("parseStoreBoardParams", () => {
  it("defaults every filter to 'all' when no params are given", () => {
    expect(parseStoreBoardParams({})).toEqual({
      category: "all",
      priceBand: "all",
      location: "all",
      merchant: "all",
    });
  });

  it("parses valid explicit values", () => {
    expect(
      parseStoreBoardParams({
        category: "retail",
        priceBand: "over_10000",
        location: "Kemang",
        merchant: "m-1",
      }),
    ).toEqual({
      category: "retail",
      priceBand: "over_10000",
      location: "Kemang",
      merchant: "m-1",
    });
  });

  it("falls back to the default for an invalid category rather than throwing", () => {
    expect(parseStoreBoardParams({ category: "groceries" })).toEqual({
      category: "all",
      priceBand: "all",
      location: "all",
      merchant: "all",
    });
  });

  it("falls back to the default for an invalid price band rather than throwing", () => {
    expect(parseStoreBoardParams({ priceBand: "cheap" })).toMatchObject({ priceBand: "all" });
  });

  it("falls back to 'all' for a blank location or merchant value", () => {
    expect(parseStoreBoardParams({ location: "   ", merchant: "" })).toMatchObject({
      location: "all",
      merchant: "all",
    });
  });

  it("falls back to 'all' for an absurdly long facet value", () => {
    expect(parseStoreBoardParams({ location: "x".repeat(500) })).toMatchObject({ location: "all" });
  });

  it("takes the first value when Next hands back a repeated query param as an array", () => {
    expect(parseStoreBoardParams({ category: ["retail", "services"] })).toMatchObject({
      category: "retail",
    });
  });
});

describe("buildStoreBoardQuery", () => {
  it("omits every param when all are at their default", () => {
    expect(
      buildStoreBoardQuery(
        { category: "all", priceBand: "all", location: "all", merchant: "all" },
        {},
      ),
    ).toBe("");
  });

  it("preserves untouched fields when updating one", () => {
    const query = buildStoreBoardQuery(
      { category: "retail", priceBand: "all", location: "all", merchant: "all" },
      { priceBand: "over_10000" },
    );
    expect(query).toContain("category=retail");
    expect(query).toContain("priceBand=over_10000");
  });

  it("drops a field from the query once it is reset back to its default", () => {
    const query = buildStoreBoardQuery(
      { category: "retail", priceBand: "all", location: "all", merchant: "all" },
      { category: "all" },
    );
    expect(query).toBe("");
  });
});

describe("hasActiveStoreFilters", () => {
  it("is false when every filter is at its default", () => {
    expect(
      hasActiveStoreFilters({
        category: "all",
        priceBand: "all",
        location: "all",
        merchant: "all",
      }),
    ).toBe(false);
  });

  it("is true when any single filter is narrowed", () => {
    expect(
      hasActiveStoreFilters({
        category: "all",
        priceBand: "all",
        location: "Kemang",
        merchant: "all",
      }),
    ).toBe(true);
  });
});
