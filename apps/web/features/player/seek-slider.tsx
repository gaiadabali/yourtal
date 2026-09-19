"use client";

import type { Chapter } from "./chapter";
import { formatClock } from "./format-clock";

export interface SeekSliderProps {
  currentSeconds: number;
  durationSeconds: number;
  chapters: readonly Chapter[];
  onSeek: (seconds: number) => void;
}

/**
 * The real, interactive seek control.
 *
 * This is a NATIVE `<input type="range">`, not a Radix Slider. The native
 * element already provides everything this control needs — `role="slider"`,
 * ArrowLeft/Right/Up/Down and Home/End seeking, `aria-valuenow/min/max`, and
 * a real touch target on mobile — while Radix Slider cost ~15 KB gz here and
 * put this route over the 170 KB initial-JS gate (docs/13b section 8). On the
 * mid-tier Android over 4G this app targets (docs/08 section 3), that weight
 * buys nothing a native input does not already do.
 *
 * `aria-valuetext` is set so a screen reader announces "3:20 of 15:00"
 * rather than a bare number of seconds.
 *
 * The purely decorative accrual bar elsewhere in this feature stays on
 * `@yourtal/ui/progress` — that one is not interactive.
 */
export function SeekSlider({ currentSeconds, durationSeconds, chapters, onSeek }: SeekSliderProps) {
  const safeDuration = Math.max(durationSeconds, 1);
  const clamped = Math.min(Math.max(currentSeconds, 0), safeDuration);
  const progressPercent = (clamped / safeDuration) * 100;

  return (
    <div className="flex w-full flex-col gap-1">
      <div className="relative flex h-5 w-full items-center">
        {/* Track and chapter ticks sit behind the input, which is transparent
            apart from its thumb. aria-hidden: the input itself carries the
            accessible name, value and description. */}
        <div
          aria-hidden="true"
          className="absolute left-0 right-0 h-1.5 overflow-hidden rounded-full bg-surface-raised"
        >
          <div className="h-full bg-primary" style={{ width: `${progressPercent}%` }} />
          {chapters.slice(1).map((chapter) => (
            <span
              key={chapter.index}
              className="absolute top-0 h-full w-px bg-border-strong"
              style={{ left: `${(chapter.startSeconds / safeDuration) * 100}%` }}
            />
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={safeDuration}
          step={1}
          value={clamped}
          aria-label="Seek"
          aria-valuetext={`${formatClock(clamped)} of ${formatClock(durationSeconds)}`}
          onChange={(event) => {
            onSeek(Number(event.target.value));
          }}
          className="relative h-5 w-full cursor-pointer appearance-none bg-transparent accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div className="flex justify-between text-xs font-sans text-fg-muted" aria-hidden="true">
        <span>{formatClock(clamped)}</span>
        <span>{formatClock(durationSeconds)}</span>
      </div>
    </div>
  );
}
