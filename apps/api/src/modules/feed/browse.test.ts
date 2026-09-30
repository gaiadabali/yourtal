import { describe, expect, it } from "vitest";
import type { FeedItem } from "@yourtal/contracts/feed";
import { toPoints } from "@yourtal/contracts/money";
import { applyFeedBrowse, feedFacets } from "./browse";

let n = 0;
function item(overrides: Partial<FeedItem>): FeedItem {
  n += 1;
  return {
    campaignId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    businessId: "22222222-2222-4222-8222-222222222222",
    merchantName: "M",
    title: `T${String(n)}`,
    synopsis: "",
    posterUrl: "https://cdn.example.com/p.jpg",
    teaserUrl: "https://cdn.example.com/t.mp4",
    durationSeconds: 120,
    rewardPoints: toPoints(5),
    kind: "long_form",
    questionCount: 1,
    maxRewardPoints: toPoints(6),
    estimatedDataMb: 10,
    contentCategory: "food-and-drink",
    tags: [],
    audience: "all_ages",
    region: "AU",
    openViewing: false,
    endingSoon: false,
    why: "Popular right now",
    whyReason: "popular",
    channelHandle: "m",
    channelLogoUrl: null,
    boosted: false,
    ...overrides,
  };
}

const keys = (order: Record<string, { published: number; ends: number }>) => ({
  publishedAt: (id: string) => order[id]?.published ?? 0,
  endsAt: (id: string) => order[id]?.ends ?? 0,
});

describe("feed browse (13.12.a)", () => {
  const long = item({ contentCategory: "books", tags: ["books"], maxRewardPoints: toPoints(9) });
  const short = item({ kind: "quick", contentCategory: "games", tags: ["games"] });
  const coffee = item({ contentCategory: "food-and-drink", tags: ["coffee", "bakery"] });
  const all = [long, short, coffee];
  const k = keys({
    [long.campaignId]: { published: 1, ends: 30 },
    [short.campaignId]: { published: 3, ends: 10 },
    [coffee.campaignId]: { published: 2, ends: 20 },
  });

  it("filters by kind, category and any-of tags", () => {
    expect(applyFeedBrowse(all, { kind: "quick", sort: "for_you" }, k)).toEqual([short]);
    expect(applyFeedBrowse(all, { category: "books", sort: "for_you" }, k)).toEqual([long]);
    expect(applyFeedBrowse(all, { tags: ["bakery", "games"], sort: "for_you" }, k)).toEqual([
      short,
      coffee,
    ]);
  });

  it("sorts newest, most points and ending soon; for you keeps the ranked order", () => {
    const ids = (items: FeedItem[]) => items.map((entry) => entry.campaignId);
    expect(ids(applyFeedBrowse(all, { sort: "for_you" }, k))).toEqual(ids(all));
    expect(ids(applyFeedBrowse(all, { sort: "newest" }, k))).toEqual(ids([short, coffee, long]));
    expect(applyFeedBrowse(all, { sort: "most_points" }, k)[0]).toBe(long);
    expect(ids(applyFeedBrowse(all, { sort: "ending_soon" }, k))).toEqual(
      ids([short, coffee, long]),
    );
  });

  it("counts facets with each facet ignoring its own filter and kind always applied", () => {
    const facets = feedFacets(all, { kind: "long_form", category: "books", sort: "for_you" });
    // Categories ignore the category filter: both long videos' categories show.
    expect(facets.categories).toEqual([
      { value: "books", count: 1 },
      { value: "food-and-drink", count: 1 },
    ]);
    // Tags honour the category filter.
    expect(facets.tags).toEqual([{ value: "books", count: 1 }]);
  });
});
