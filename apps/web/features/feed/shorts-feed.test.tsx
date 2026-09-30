import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import feedMessages from "@/messages/en-AU/feed.json";
import type { ShortsFeedData } from "./feed-data";
import { ShortsFeed } from "./shorts-feed";

function baseData(overrides: Partial<ShortsFeedData> = {}): ShortsFeedData {
  return {
    items: [],
    savedIds: [],
    earnedToday: 0,
    autoplay: "always",
    ageBand: "adult",
    ...overrides,
  };
}

function renderFeed(data: ShortsFeedData) {
  return render(
    <NextIntlClientProvider locale="en-AU" messages={{ feed: feedMessages }}>
      <ShortsFeed data={data} locale="en-AU" publicBase="https://yourtal.com/au" />
    </NextIntlClientProvider>,
  );
}

describe("ShortsFeed (13.14.a)", () => {
  it("is one swipe feed: no tabs and no side lists", () => {
    renderFeed(baseData());
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.queryByText("Continue watching")).not.toBeInTheDocument();
    expect(screen.getByText("You're all caught up")).toBeInTheDocument();
  });

  // 12.4.d/#7: nothing "Ending soon" for a teen anywhere.
  it("shows a teen no Ending soon", () => {
    renderFeed(baseData({ ageBand: "teen" }));
    expect(screen.queryByText("Ending soon")).not.toBeInTheDocument();
  });
});
