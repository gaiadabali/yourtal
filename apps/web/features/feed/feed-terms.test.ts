import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import enAU from "@/messages/en-AU/feed.json";
import idID from "@/messages/id-ID/feed.json";
import { earnsInFeed, feedTermsLine, formatFeedPoints } from "./feed-terms";
import type { FeedTermsTranslator } from "./feed-terms";

function translator(locale: "en-AU" | "id-ID"): FeedTermsTranslator {
  const t = createTranslator({
    locale,
    messages: { feed: locale === "en-AU" ? enAU : idID },
    namespace: "feed",
  });
  return (key, values) => t(key as never, values as never);
}

const LONG = {
  kind: "long_form",
  durationSeconds: 18 * 60 - 20,
  questionCount: 3,
  rewardPoints: 90,
  maxRewardPoints: 112,
  estimatedDataMb: 119.6,
} as const;

describe("feedTermsLine", () => {
  it("states length, questions, the most you can earn, data and the finish rule (AU)", () => {
    expect(feedTermsLine(translator("en-AU"), "en-AU", LONG)).toBe(
      `18 min · 3 questions · up to ${formatFeedPoints("en-AU", 112)} · ~120 MB · finish to earn`,
    );
  });

  it("never rounds a length down", () => {
    const line = feedTermsLine(translator("en-AU"), "en-AU", { ...LONG, durationSeconds: 61 });
    expect(line.startsWith("2 min")).toBe(true);
  });

  it("gives a quick campaign its seconds and flat reward, with no questions", () => {
    const line = feedTermsLine(translator("en-AU"), "en-AU", {
      ...LONG,
      kind: "quick",
      durationSeconds: 45,
      questionCount: 0,
      rewardPoints: 4,
      maxRewardPoints: 4,
      estimatedDataMb: 7.5,
    });
    expect(line.startsWith("45 s · 4")).toBe(true);
    expect(line).not.toContain("question");
    expect(line).not.toContain("up to");
  });

  it("speaks Indonesian for an id-ID viewer", () => {
    const line = feedTermsLine(translator("id-ID"), "id-ID", LONG);
    expect(line).toContain("3 pertanyaan");
    expect(line).toContain("hingga");
  });
});

describe("earnsInFeed", () => {
  it("is true only for quick campaigns under a minute (F15)", () => {
    expect(earnsInFeed({ kind: "quick", durationSeconds: 59 })).toBe(true);
    expect(earnsInFeed({ kind: "quick", durationSeconds: 60 })).toBe(false);
    expect(earnsInFeed({ kind: "long_form", durationSeconds: 30 })).toBe(false);
  });
});
