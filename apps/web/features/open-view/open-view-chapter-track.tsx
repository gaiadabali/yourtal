"use client";

import { Button } from "@yourtal/ui/button";
import type { PlayerChapter } from "@/features/player/player-chapters";
import { formatClock } from "@/features/player/format-clock";

export interface OpenViewChapterTrackProps {
  chapters: readonly PlayerChapter[];
  reachedChapterIndex: number;
  currentSeconds: number;
  onSelectChapter: (startSeconds: number) => void;
  watchedLabel: string;
  watchingLabel: string;
  upcomingLabel: string;
}

/**
 * A reward-free sibling of `features/player/chapter-track.tsx` (YT-0432).
 * That component's labels are caller-supplied (own-i18n) rather than
 * fixed English/`formatPoints` strings, and — as of decision O-1
 * (docs/16-decisions.md) — shows no per-chapter point figure at all, since
 * chapters are a progress device, not an accrual device, on either the
 * signed-in or the open-view path. This component predates that fix and
 * was already stricter for a different reason: this ticket's first
 * acceptance criterion forbids reward UI for an anonymous viewer
 * specifically, so it never showed a point value or an "earned" status to
 * begin with. Everything else (real per-chapter buttons, native tab order,
 * one status word) is copied deliberately, so an anonymous viewer gets the
 * identical structural experience minus the one thing that would be
 * dishonest to show them.
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
              <span className="text-xs font-semibold">{chapter.title}</span>
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
