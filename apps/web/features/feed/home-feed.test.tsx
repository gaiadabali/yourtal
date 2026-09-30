import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import feedMessages from "@/messages/en-AU/feed.json";
import type { HomeFeedData } from "./feed-data";
import { HomeFeed } from "./home-feed";

/**
 * 12.4.d/#7: no "Ending soon" row or tab for a teen, anywhere in Home —
 * `ranking.test.ts`/`feed-teen-ending-soon.e2e.test.ts` already prove the
 * API never flags an item ending soon for a teen; this proves the row and
 * its tab are dropped here too, not merely left to render empty.
 */
function baseData(overrides: Partial<HomeFeedData> = {}): HomeFeedData {
  return {
    items: [],
    savedIds: [],
    rows: { continue: [], saved: [], following: [], endingSoon: [] },
    streakDays: 3,
    pending: [],
    earnedToday: 0,
    autoplay: "always",
    ageBand: "adult",
    ...overrides,
  };
}

function renderFeed(data: HomeFeedData) {
  return render(
    <NextIntlClientProvider locale="en-AU" messages={{ feed: feedMessages }}>
      <HomeFeed data={data} locale="en-AU" publicBase="https://yourtal.com/au" />
    </NextIntlClientProvider>,
  );
}

describe("HomeFeed", () => {
  it("an adult sees the Ending soon tab", () => {
    renderFeed(baseData({ ageBand: "adult" }));
    expect(screen.getByRole("radio", { name: "Ending soon" })).toBeInTheDocument();
  });

  it("a teen never sees the Ending soon tab or row, even when the row would have items", () => {
    renderFeed(
      baseData({
        ageBand: "teen",
        rows: {
          continue: [],
          saved: [],
          following: [],
          endingSoon: [
            {
              campaignId: "11111111-1111-1111-1111-111111111111",
              title: "Ending Soon Campaign",
              merchantName: "Test Merchant",
              posterUrl: "https://cdn.example.com/poster.jpg",
              durationSeconds: 30,
            },
          ],
        },
      }),
    );
    expect(screen.queryByRole("radio", { name: "Ending soon" })).not.toBeInTheDocument();
    expect(screen.queryByText("Ending Soon Campaign")).not.toBeInTheDocument();
  });
});
