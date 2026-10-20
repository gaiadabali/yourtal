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
    posterVariants: [],
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

function renderItem(item: FeedItemData, props: { mounted?: boolean; priority?: boolean } = {}) {
  return render(
    <NextIntlClientProvider locale="en-AU" messages={{ feed: feedMessages }}>
      <FeedItem
        item={item}
        locale="en-AU"
        active={false}
        mounted={props.mounted ?? false}
        {...(props.priority ? { priority: true } : {})}
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

// 14.6.b: the poster is an <img> with srcset, so the browser picks a size for the screen.
describe("FeedItem — responsive poster", () => {
  const variants = [
    { url: "https://cdn.example.com/posters/a-320.jpg", width: 320 },
    { url: "https://cdn.example.com/poster.jpg", width: 640 },
    { url: "https://cdn.example.com/posters/a-960.jpg", width: 960 },
  ];

  it("gives the poster every size, and the first Short's high priority", () => {
    const { container } = renderItem(baseItem({ posterVariants: variants }), { priority: true });
    const img = container.querySelector("img[src='https://cdn.example.com/poster.jpg']");
    expect(img).toHaveAttribute(
      "srcset",
      "https://cdn.example.com/posters/a-320.jpg 320w, https://cdn.example.com/poster.jpg 640w, https://cdn.example.com/posters/a-960.jpg 960w",
    );
    expect(img).toHaveAttribute("sizes", "min(440px, calc(100vw - 2rem))");
    expect(img).toHaveAttribute("fetchpriority", "high");
  });

  it("falls back to the single poster when the server sent no sizes", () => {
    const { container } = renderItem(baseItem());
    const img = container.querySelector("img[src='https://cdn.example.com/poster.jpg']");
    expect(img).not.toHaveAttribute("srcset");
  });
});
