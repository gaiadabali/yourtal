import { describe, expect, it } from "vitest";
import { campaignChapterSchema, chapterEndSeconds, chapterRewardPoints } from "./campaign-chapter";

describe("campaignChapterSchema", () => {
  it("round-trips a valid chapter", () => {
    const parsed = campaignChapterSchema.parse({
      title: "Chapter 1",
      startSeconds: 0,
      rewardWeight: 1,
    });
    expect(parsed.title).toBe("Chapter 1");
  });

  it("rejects a non-positive reward weight", () => {
    expect(
      campaignChapterSchema.safeParse({ title: "Chapter 1", startSeconds: 0, rewardWeight: 0 })
        .success,
    ).toBe(false);
  });

  it("rejects a negative start", () => {
    expect(
      campaignChapterSchema.safeParse({ title: "Chapter 1", startSeconds: -1, rewardWeight: 1 })
        .success,
    ).toBe(false);
  });
});

describe("chapterEndSeconds", () => {
  const chapters = [
    { title: "1", startSeconds: 0, rewardWeight: 1 },
    { title: "2", startSeconds: 100, rewardWeight: 1 },
    { title: "3", startSeconds: 250, rewardWeight: 1 },
  ];

  it("ends at the next chapter's start", () => {
    expect(chapterEndSeconds(chapters, 0, 600)).toBe(100);
    expect(chapterEndSeconds(chapters, 1, 600)).toBe(250);
  });

  it("ends the last chapter at the campaign's own duration", () => {
    expect(chapterEndSeconds(chapters, 2, 600)).toBe(600);
  });
});

describe("chapterRewardPoints", () => {
  it("reproduces docs/06 section 3's worked example exactly", () => {
    const chapters = [1, 1, 1, 2, 5].map((rewardWeight, index) => ({
      title: `Chapter ${String(index + 1)}`,
      startSeconds: index * 100,
      rewardWeight,
    }));

    expect(chapterRewardPoints(chapters, 2_000)).toEqual([200, 200, 200, 400, 1_000]);
  });

  it("always sums exactly to the total, remainder folded into the last chapter", () => {
    const chapters = [1, 1, 1].map((rewardWeight, index) => ({
      title: `Chapter ${String(index + 1)}`,
      startSeconds: index * 10,
      rewardWeight,
    }));

    const allocations = chapterRewardPoints(chapters, 100);
    expect(allocations.reduce((sum, value) => sum + value, 0)).toBe(100);
    // 100 / 3 is not exact; the remainder must land on the back-loaded end.
    expect(allocations).toEqual([33, 33, 34]);
  });

  it("returns an empty allocation for a campaign with no chapters", () => {
    expect(chapterRewardPoints([], 500)).toEqual([]);
  });
});
