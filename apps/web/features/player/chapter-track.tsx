"use client";

import { Button } from "@yourtal/ui/button";
import { asDisplayPoints, formatPoints } from "@yourtal/contracts/money/format";
import type { Chapter } from "./chapter";
import { formatClock } from "./format-clock";

export interface ChapterTrackProps {
  chapters: readonly Chapter[];
  reachedChapterIndex: number;
  currentSeconds: number;
  onSelectChapter: (startSeconds: number) => void;
  /** YT-0405: defaults to "id-ID" so existing callers are unaffected. */
  locale?: "en-AU" | "id-ID";
}

/**
 * Chapter markers as real, individually focusable, individually labelled
 * buttons — not just visual ticks on the seek bar — so they are reachable
 * by keyboard (plain tab order) and announced (native button semantics,
 * full status in the accessible name) per the acceptance criteria. The
 * matching visual ticks on the slider itself (seek-slider.tsx) are
 * `aria-hidden`, since these buttons are the one accessible affordance —
 * two competing announcements for the same information would be worse than
 * one.
 */
export function ChapterTrack({
  chapters,
  reachedChapterIndex,
  currentSeconds,
  onSelectChapter,
  locale = "id-ID",
}: ChapterTrackProps) {
  return (
    <ol className="flex w-full list-none gap-1.5 overflow-x-auto p-0" aria-label="Chapters">
      {chapters.map((chapter) => {
        const isReached = chapter.index <= reachedChapterIndex;
        const isCurrent =
          currentSeconds >= chapter.startSeconds && currentSeconds < chapter.endSeconds;
        const status = isReached ? "earned" : isCurrent ? "in progress" : "upcoming";

        return (
          <li key={chapter.index} className="min-w-0 flex-1">
            <Button
              type="button"
              variant={isCurrent ? "default" : isReached ? "secondary" : "outline"}
              size="sm"
              className="h-auto w-full flex-col items-start gap-0.5 whitespace-normal py-1.5 text-left"
              aria-current={isCurrent ? "step" : undefined}
              onClick={() => onSelectChapter(chapter.startSeconds)}
            >
              <span className="text-xs font-semibold">{chapter.label}</span>
              <span className="text-[10px] font-normal opacity-80">
                {formatClock(chapter.startSeconds)}–{formatClock(chapter.endSeconds)} ·{" "}
                {formatPoints(asDisplayPoints(chapter.rewardPoints), locale)} · {status}
              </span>
            </Button>
          </li>
        );
      })}
    </ol>
  );
}
