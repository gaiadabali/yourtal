"use client";

import { asDisplayPoints, formatPoints } from "@yourtal/contracts/money/format";
import { STREAK_CYCLE_POINTS } from "./streak-schedule";
import { getStreakTranslator, type SupportedLocale } from "./streak-i18n";

export interface StreakLadderProps {
  /** 1..STREAK_CYCLE_LENGTH — today's position (already reached, or on offer). */
  cycleDay: number;
  hasCheckedInToday: boolean;
  locale: SupportedLocale;
}

/**
 * The 7-day reward ladder, visual sibling of `features/player/chapter-
 * track.tsx` — real, individually labelled `<li>` entries (not just visual
 * ticks), one status word each, so the schedule is announced correctly
 * either way a screen reader lands on it. Unlike the video player's
 * chapter track, this one legitimately shows each day's point figure: a
 * check-in reward is a real, single, immediately-decided grant per day
 * (no later "checkpoint" reduces or withholds it the way O-1 does for the
 * video reward), so there is no O-1-shaped risk in stating it up front.
 */
export function StreakLadder({ cycleDay, hasCheckedInToday, locale }: StreakLadderProps) {
  const t = getStreakTranslator(locale);

  return (
    <ol className="flex w-full list-none gap-1 p-0">
      {STREAK_CYCLE_POINTS.map((points, index) => {
        const dayNumber = index + 1;
        const isPast = dayNumber < cycleDay || (dayNumber === cycleDay && hasCheckedInToday);
        const isToday = dayNumber === cycleDay && !hasCheckedInToday;
        const status = isPast
          ? t("ladderStatusDone")
          : isToday
            ? t("ladderStatusToday")
            : t("ladderStatusUpcoming");

        return (
          <li
            key={dayNumber}
            aria-current={isToday ? "step" : undefined}
            className={
              "flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-md border py-1.5 text-center " +
              (isPast
                ? "border-border bg-surface-raised text-fg"
                : isToday
                  ? "border-primary bg-primary text-primary-fg"
                  : "border-border bg-transparent text-fg-muted")
            }
          >
            <span className="text-caption font-semibold">
              {t("ladderDayLabel", { day: dayNumber })}
            </span>
            <span className="text-caption opacity-90">
              {formatPoints(asDisplayPoints(points), locale)}
            </span>
            <span className="sr-only"> · {status}</span>
          </li>
        );
      })}
    </ol>
  );
}
