"use client";

import { useQuestionTimer } from "./use-question-timer";

export interface CheckpointTimerProps {
  totalSeconds: number;
  onExpire: () => void;
}

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Visible + accessible countdown for one checkpoint question.
 *
 * Two separate pieces of markup do two separate jobs:
 * - The visible clock uses `role="timer"`, whose WAI-ARIA default is an
 *   "off" live-region politeness — it updates every second visually and
 *   exposes its current value on demand (a screen-reader user who
 *   navigates to it hears the current reading), but is never pushed at
 *   the user unprompted.
 * - A visually-hidden `role="status" aria-live="polite"` region carries
 *   the actual announcements, and only changes at the thresholds computed
 *   in `use-question-timer.ts` — not every second. "polite" (rather than
 *   "assertive") means it waits for the screen reader to finish whatever
 *   it is currently saying — including the question prompt itself — before
 *   speaking, so the countdown never talks over the question.
 */
export function CheckpointTimer({ totalSeconds, onExpire }: CheckpointTimerProps) {
  const { remainingSeconds, announcement } = useQuestionTimer(totalSeconds, onExpire);

  return (
    <div className="flex items-center gap-2">
      <div
        role="timer"
        aria-label={`Sisa waktu: ${formatClock(remainingSeconds)}`}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3 py-1 text-sm font-sans font-medium tabular-nums text-fg"
      >
        {formatClock(remainingSeconds)}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
