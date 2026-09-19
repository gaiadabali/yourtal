import { describe, expect, it } from "vitest";
import {
  createChapter,
  estimateDataMb,
  sortChapters,
  totalDurationSeconds,
} from "./campaign-chapter";

describe("totalDurationSeconds", () => {
  it("is 0 with no chapters", () => {
    expect(totalDurationSeconds([])).toBe(0);
  });

  it("is the last chapter's start plus the minimum chapter length", () => {
    const chapters = [
      createChapter("Intro", 0),
      createChapter("Middle", 300),
      createChapter("Close", 600),
    ];
    expect(totalDurationSeconds(chapters)).toBe(630);
  });
});

describe("estimateDataMb", () => {
  // Directly from docs/06 §2.3's own worked table.
  const table: Array<{ minutes: number; expectedMb: number }> = [
    { minutes: 1, expectedMb: 6 },
    { minutes: 5, expectedMb: 30 },
    { minutes: 15, expectedMb: 90 },
    { minutes: 30, expectedMb: 180 },
  ];

  it.each(table)(
    "estimates $expectedMb MB for a $minutes-minute video",
    ({ minutes, expectedMb }) => {
      expect(estimateDataMb(minutes * 60)).toBe(expectedMb);
    },
  );
});

describe("sortChapters", () => {
  it("orders chapters by start time regardless of input order", () => {
    const chapters = [
      createChapter("Close", 600),
      createChapter("Intro", 0),
      createChapter("Middle", 300),
    ];
    expect(sortChapters(chapters).map((chapter) => chapter.title)).toStrictEqual([
      "Intro",
      "Middle",
      "Close",
    ]);
  });
});
