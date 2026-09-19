import { describe, expect, it } from "vitest";
import { deriveChapters } from "./derive-chapters";

describe("deriveChapters", () => {
  it("reproduces docs/06 §3's own worked example: 200/200/200/400/1000 for a 2,000-point, 15-minute campaign", () => {
    const chapters = deriveChapters({ durationSeconds: 900, rewardPoints: 2_000 });

    expect(chapters.map((chapter) => chapter.rewardPoints)).toEqual([200, 200, 200, 400, 1_000]);
    expect(chapters).toHaveLength(5);
  });

  it("splits duration into 5 contiguous, gapless segments covering the whole video", () => {
    const chapters = deriveChapters({ durationSeconds: 901, rewardPoints: 1_000 });

    expect(chapters[0]?.startSeconds).toBe(0);
    for (let i = 1; i < chapters.length; i += 1) {
      expect(chapters[i]?.startSeconds).toBe(chapters[i - 1]?.endSeconds);
    }
    expect(chapters.at(-1)?.endSeconds).toBe(901);
  });

  it("keeps the last chapter worth more than the first three combined, for any reward total", () => {
    for (const rewardPoints of [0, 1, 7, 2_000, 4_999]) {
      const chapters = deriveChapters({ durationSeconds: 600, rewardPoints });
      const firstThree = (chapters[0]?.rewardPoints ?? 0) + (chapters[1]?.rewardPoints ?? 0) + (chapters[2]?.rewardPoints ?? 0);
      const last = chapters.at(-1)?.rewardPoints ?? 0;
      expect(last).toBeGreaterThanOrEqual(firstThree);
    }
  });

  it("always allocates exactly the campaign's total reward points, with no rounding leakage", () => {
    for (const rewardPoints of [1, 3, 999, 2_001, 4_999]) {
      const chapters = deriveChapters({ durationSeconds: 300, rewardPoints });
      const total = chapters.reduce((sum, chapter) => sum + chapter.rewardPoints, 0);
      expect(total).toBe(rewardPoints);
    }
  });

  it("handles a zero-reward campaign without throwing (docs/tasks/phase-u-ui.md's zero-reward fixture)", () => {
    const chapters = deriveChapters({ durationSeconds: 600, rewardPoints: 0 });
    expect(chapters.every((chapter) => chapter.rewardPoints === 0)).toBe(true);
  });
});
