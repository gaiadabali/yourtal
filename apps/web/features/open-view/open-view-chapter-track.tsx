"use client";

import { Button } from "@yourtal/ui/button";
import type { Chapter } from "@/features/player/chapter";
import { formatClock } from "@/features/player/format-clock";

export interface OpenViewChapterTrackProps {
  chapters: readonly Chapter[];
  reachedChapterIndex: number;
  currentSeconds: number;
  onSelectChapter: (startSeconds: number) => void;
  watchedLabel: string;
  watchingLabel: string;
  upcomingLabel: string;
}

/**
 * A reward-free sibling of `features/player/chapter-track.tsx` (YT-0432).
 * That component's own accessible name deliberately includes each
 * chapter's point value and an "earned" status — exactly the "reward UI"
 * this ticket's first acceptance criterion forbids for an anonymous
 * viewer — so it cannot be reused unmodified here. Everything else (real
 * per-chapter buttons, native tab order, one status word) is copied
 * deliberately, so an anonymous viewer gets the identical structural
 * experience minus the one thing that would be dishonest to show them.
 */
export function OpenViewChapterTrack({
  chapters,
  reachedChapterIndex,
  currentSeconds,
  onSelectChapter,
  watchedLabel,
  watchingLabel,
  upcomingLabel,
}: OpenViewChapterTrackProps) {
  return (
    <ol className="flex w-full list-none gap-1.5 overflow-x-auto p-0" aria-label="Chapters">
      {chapters.map((chapter) => {
        const isReached = chapter.index <= reachedChapterIndex;
        const isCurrent =
          currentSeconds >= chapter.startSeconds && currentSeconds < chapter.endSeconds;
        const status = isReached ? watchedLabel : isCurrent ? watchingLabel : upcomingLabel;

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
                {formatClock(chapter.startSeconds)}–{formatClock(chapter.endSeconds)} · {status}
              </span>
            </Button>
          </li>
        );
      })}
    </ol>
  );
}
