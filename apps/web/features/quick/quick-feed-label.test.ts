import { describe, expect, it } from "vitest";
import { buildQuickFeedItemLabel } from "./quick-feed-label";

describe("buildQuickFeedItemLabel", () => {
  it("states position, total, merchant and title in one sentence", () => {
    expect(
      buildQuickFeedItemLabel({
        merchantName: "Toko ABC",
        title: "Promo Kilat",
        position: 3,
        total: 12,
      }),
    ).toBe("Video 3 dari 12: Toko ABC — Promo Kilat");
  });

  it("handles a feed of exactly one item", () => {
    expect(
      buildQuickFeedItemLabel({
        merchantName: "Toko Solo",
        title: "Satu-satunya",
        position: 1,
        total: 1,
      }),
    ).toBe("Video 1 dari 1: Toko Solo — Satu-satunya");
  });

  it("states position, total, merchant and title in English for en-AU (YT-0405)", () => {
    expect(
      buildQuickFeedItemLabel({
        merchantName: "Toko ABC",
        title: "Promo Kilat",
        position: 3,
        total: 12,
        locale: "en-AU",
      }),
    ).toBe("Video 3 of 12: Toko ABC — Promo Kilat");
  });
});
