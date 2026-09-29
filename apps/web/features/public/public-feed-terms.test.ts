import { describe, expect, it } from "vitest";
import type { FeedItem } from "@yourtal/contracts/feed";
import { describeFeedItemTerms } from "./public-feed-terms";
import { publicLocaleConfig } from "./public-locale";

/** A minimal, schema-valid `FeedItem` (F78) — only the fields `describeFeedItemTerms` reads vary per test. */
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

describe("describeFeedItemTerms (11.1.b, F12)", () => {
  it("builds the honest terms line in en-AU: duration, questions, up to N pts, data, finish to earn", () => {
    const label = describeFeedItemTerms(feedItem(), publicLocaleConfig("au"));
    expect(label).toBe("18 min · 3 questions · up to 112 pts · ~120 MB · finish to earn");
  });

  it("reads naturally for a Quick campaign with no questions", () => {
    const label = describeFeedItemTerms(
      feedItem({ kind: "quick", questionCount: 0, durationSeconds: 45, maxRewardPoints: 20 }),
      publicLocaleConfig("au"),
    );
    expect(label).toBe("45 sec · No questions · up to 20 pts · ~120 MB · finish to earn");
  });

  it("localises into id-ID", () => {
    const label = describeFeedItemTerms(feedItem(), publicLocaleConfig("id"));
    expect(label).toBe(
      "18 menit · 3 pertanyaan · hingga 112 poin · ~120 MB · selesaikan untuk dapat poin",
    );
  });
});
