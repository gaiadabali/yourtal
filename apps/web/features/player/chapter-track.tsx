"use client";

import { Button } from "@yourtal/ui/button";
import type { PlayerChapter } from "./player-chapters";
import { formatClock } from "./format-clock";
import { getPlayerTranslator, type SupportedLocale } from "./player-i18n";

export interface ChapterTrackProps {
  chapters: readonly PlayerChapter[];
  reachedChapterIndex: number;
  currentSeconds: number;
  onSelectChapter: (startSeconds: number) => void;
  locale: SupportedLocale;
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
 *
 * Decision O-1 (docs/16-decisions.md, 2026-09-20) and its consequence O-2:
 * chapters are a **progress and navigation device, not an accrual device**.
 * This previously labelled a reached chapter "earned" and printed its own
 * `rewardPoints` figure next to that label — together they read as a
 * discrete grant banked at that chapter, which is exactly wrong under
 * all-or-nothing: quitting one chapter later still pays nothing. So a
 * reached chapter now says "watched", never "earned", and no per-chapter
 * point figure is rendered at all — `chapter.rewardPoints` remains on the
 * data model (derive-chapters.ts still needs it to compute the single
 * total paid at completion) but is not surfaced here as if it were already
 * secured.
 */
export function ChapterTrack({
  chapters,
  reachedChapterIndex,
  currentSeconds,
  onSelectChapter,
  locale,
}: ChapterTrackProps) {
  const t = getPlayerTranslator(locale);
  return (
    <ol
      className="flex w-full list-none gap-1.5 overflow-x-auto p-0"
      aria-label={t("chapters.ariaLabel")}
    >
      {chapters.map((chapter) => {
        const isReached = chapter.index <= reachedChapterIndex;
        const isCurrent =
          currentSeconds >= chapter.startSeconds && currentSeconds < chapter.endSeconds;
        const status = isReached
          ? t("chapters.watched")
          : isCurrent
            ? t("chapters.inProgress")
            : t("chapters.upcoming");

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
              <span className="text-caption font-normal">
                {formatClock(chapter.startSeconds)}–{formatClock(chapter.endSeconds)} · {status}
              </span>
            </Button>
          </li>
        );
      })}
    </ol>
  );
}
