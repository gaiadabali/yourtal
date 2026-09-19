import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChapterTrack } from "./chapter-track";
import type { Chapter } from "./chapter";

const chapters: Chapter[] = [
  { index: 0, label: "Chapter 1", startSeconds: 0, endSeconds: 180, rewardPoints: 200 },
  { index: 1, label: "Chapter 2", startSeconds: 180, endSeconds: 360, rewardPoints: 400 },
];

describe("ChapterTrack", () => {
  it("renders each chapter as an individually labelled, keyboard-reachable button (not just a visual tick)", () => {
    render(
      <ChapterTrack chapters={chapters} reachedChapterIndex={0} currentSeconds={200} onSelectChapter={vi.fn()} />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAccessibleName(/earned/);
    expect(buttons[1]).toHaveAccessibleName(/in progress/);
  });

  it("seeks to a chapter's start on click", async () => {
    const user = userEvent.setup();
    const onSelectChapter = vi.fn();
    render(
      <ChapterTrack chapters={chapters} reachedChapterIndex={-1} currentSeconds={0} onSelectChapter={onSelectChapter} />,
    );

    await user.click(screen.getByRole("button", { name: /Chapter 2/ }));
    expect(onSelectChapter).toHaveBeenCalledWith(180);
  });

  it("seeks to a chapter's start via keyboard activation alone (Tab + Enter, no mouse)", async () => {
    const user = userEvent.setup();
    const onSelectChapter = vi.fn();
    render(
      <ChapterTrack chapters={chapters} reachedChapterIndex={-1} currentSeconds={0} onSelectChapter={onSelectChapter} />,
    );

    await user.tab(); // focuses Chapter 1
    await user.tab(); // focuses Chapter 2
    await user.keyboard("{Enter}");
    expect(onSelectChapter).toHaveBeenCalledWith(180);
  });
});
