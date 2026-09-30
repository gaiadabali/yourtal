import { describe, expect, it } from "vitest";
import { browseHref, feedApiPath, parseBrowseQuery } from "./browse-query";

describe("browse query (13.13.b)", () => {
  it("keeps known categories, tags and sorts, and drops the rest", () => {
    expect(
      parseBrowseQuery({
        category: "food-and-drink",
        tags: "coffee,bakery,nope,coffee",
        sort: "newest",
      }),
    ).toStrictEqual({ category: "food-and-drink", tags: ["coffee", "bakery"], sort: "newest" });
    expect(parseBrowseQuery({ category: "coffee-specialty", sort: "loudest" })).toStrictEqual({
      category: null,
      tags: [],
      sort: "for_you",
    });
  });

  it("round-trips through the URL, with defaults left out", () => {
    const query = { category: "fitness", tags: ["gym"], sort: "most_points" } as const;
    expect(browseHref(query)).toBe("/home?category=fitness&tags=gym&sort=most_points");
    expect(
      parseBrowseQuery(Object.fromEntries(new URL(browseHref(query), "http://x").searchParams)),
    ).toStrictEqual(query);
    expect(browseHref({ category: null, tags: [], sort: "for_you" })).toBe("/home");
  });

  it("asks the API for long videos only on Home", () => {
    expect(feedApiPath({ category: null, tags: [], sort: "for_you" }, "long_form")).toBe(
      "/api/feed?surface=home&kind=long_form",
    );
  });
});
