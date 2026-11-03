import { describe, expect, it } from "vitest";
import { playerChapters } from "./player-chapters";
import type { ChapterSourceCampaign } from "./player-chapters";

function campaignWith(
  title: string,
  chapters: { title: string; startSeconds: number }[],
): ChapterSourceCampaign {
  return {
    title,
    durationSeconds: 90,
    rewardPoints: 100,
    chapters: chapters.map((chapter) => ({ ...chapter, rewardWeight: 1 })),
  } as ChapterSourceCampaign;
}

describe("playerChapters", () => {
  it("names a whole-video chapter after the campaign as it is now, not as it was uploaded (V14)", () => {
    const campaign = campaignWith("Choosing a first bike", [
      { title: "Untitled campaign", startSeconds: 0 },
    ]);
    expect(playerChapters(campaign).map((chapter) => chapter.title)).toEqual([
      "Choosing a first bike",
    ]);
  });

  it("keeps each chapter's own title when there are several", () => {
    const campaign = campaignWith("Choosing a first bike", [
      { title: "Sizing", startSeconds: 0 },
      { title: "Brakes", startSeconds: 40 },
    ]);
    expect(playerChapters(campaign).map((chapter) => chapter.title)).toEqual(["Sizing", "Brakes"]);
  });
});
