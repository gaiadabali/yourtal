import { describe, expect, it } from "vitest";
import type { FeedItem } from "@yourtal/contracts/feed";
import { toPublicFeedTeaserItems } from "./public-feed-view";
import { publicLocaleConfig } from "./public-locale";

function feedItem(overrides: Partial<Record<keyof FeedItem, unknown>> = {}): FeedItem {
  return {
    campaignId: "b2b5b8b2-6b1a-4b1a-8b1a-6b1a4b1a8b1a",
    businessId: "c2b5b8b2-6b1a-4b1a-8b1a-6b1a4b1a8b1a",
    merchantName: "Warung Kopi",
    title: "Behind the roast",
    synopsis: "A short look at how the beans are sourced.",
    posterUrl: "https://cdn.example.com/poster.jpg",
    teaserUrl: "https://cdn.example.com/teaser.mp4",
    durationSeconds: 1080,
    rewardPoints: 90,
    kind: "long_form",
    questionCount: 3,
    maxRewardPoints: 112,
    estimatedDataMb: 120,
    contentCategory: "food-and-drink",
    audience: "all_ages",
    region: "AU",
    openViewing: true,
    endingSoon: false,
    why: "Popular right now",
    ...overrides,
  } as FeedItem;
}

describe("toPublicFeedTeaserItems (11.1.b)", () => {
  it("maps a feed item to a teaser view item, linking to the campaign's public page", () => {
    const [item] = toPublicFeedTeaserItems([feedItem()], "au", publicLocaleConfig("au"));
    expect(item).toEqual({
      id: "b2b5b8b2-6b1a-4b1a-8b1a-6b1a4b1a8b1a",
      href: "/au/c/b2b5b8b2-6b1a-4b1a-8b1a-6b1a4b1a8b1a",
      merchantName: "Warung Kopi",
      title: "Behind the roast",
      poster: "https://cdn.example.com/poster.jpg",
      teaser: "https://cdn.example.com/teaser.mp4",
      termsLabel: "18 min · 3 questions · up to 112 pts · ~120 MB · finish to earn",
    });
  });

  it("links into the id catalogue for the id locale", () => {
    const [item] = toPublicFeedTeaserItems(
      [feedItem({ campaignId: "d2b5b8b2-6b1a-4b1a-8b1a-6b1a4b1a8b1a" })],
      "id",
      publicLocaleConfig("id"),
    );
    expect(item?.href).toBe("/id/c/d2b5b8b2-6b1a-4b1a-8b1a-6b1a4b1a8b1a");
  });

  it("maps an empty feed to an empty list", () => {
    expect(toPublicFeedTeaserItems([], "au", publicLocaleConfig("au"))).toEqual([]);
  });
});
