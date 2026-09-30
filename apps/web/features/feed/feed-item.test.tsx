import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FeedItem as FeedItemData } from "@yourtal/contracts/feed";
import { toPoints } from "@yourtal/contracts/money";
import feedMessages from "@/messages/en-AU/feed.json";
import { FeedItem } from "./feed-item";

// `use-quick-earn.ts` and `feed-item-actions.tsx` both call into
// `"./feed-actions"`, a `"use server"` module — mocked the same way
// `register-form.test.tsx` mocks `auth-actions.ts`; this file only tests
// what renders, never a real watch/save/share round trip.
vi.mock("./feed-actions", () => ({
  startWatchAction: vi.fn(),
  reportWatchProgressAction: vi.fn(),
  completeWatchAction: vi.fn(),
  notInterestedAction: vi.fn(),
  setSavedAction: vi.fn(),
}));

function baseItem(overrides: Partial<FeedItemData> = {}): FeedItemData {
  return {
    campaignId: "11111111-1111-1111-1111-111111111111",
    businessId: "22222222-2222-2222-2222-222222222222",
    merchantName: "Test Merchant",
    title: "Test Campaign",
    synopsis: "A campaign for feed-item.test.tsx.",
    posterUrl: "https://cdn.example.com/poster.jpg",
    teaserUrl: "https://cdn.example.com/teaser.mp4",
    durationSeconds: 30,
    rewardPoints: toPoints(100),
    kind: "long_form",
    questionCount: 0,
    maxRewardPoints: toPoints(100),
    estimatedDataMb: 10,
    contentCategory: "food-and-drink",
    tags: [],
    audience: "all_ages",
    region: "AU",
    openViewing: false,
    endingSoon: false,
    why: "Popular right now",
    whyReason: "popular",
    channelHandle: "test-merchant",
    channelLogoUrl: null,
    boosted: false,
    ...overrides,
  };
}

function renderItem(item: FeedItemData) {
  return render(
    <NextIntlClientProvider locale="en-AU" messages={{ feed: feedMessages }}>
      <FeedItem
        item={item}
        locale="en-AU"
        active={false}
        mounted={false}
        postersOnly
        saved={false}
        shareUrl="https://yourtal.com/au/c/campaign-id"
        onHidden={() => undefined}
      />
    </NextIntlClientProvider>,
  );
}

// 12.4.d/#9 and 13.23.f (F90): every card discloses it is a brand's video;
// a boosted one says "Sponsored".
describe("FeedItem — brand disclosure", () => {
  it("labels an unboosted card as a brand video", () => {
    renderItem(baseItem());
    expect(screen.getByText("Brand video")).toBeInTheDocument();
    expect(screen.queryByText("Sponsored")).not.toBeInTheDocument();
  });

  it("labels a boosted card Sponsored", () => {
    renderItem({ ...baseItem(), boosted: true });
    expect(screen.getByText("Sponsored")).toBeInTheDocument();
  });
});
