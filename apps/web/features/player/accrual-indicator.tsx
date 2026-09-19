"use client";

import { asDisplayPoints, formatPoints } from "@yourtal/contracts/money/format";

export interface AccrualIndicatorProps {
  accruedPoints: number;
  totalPoints: number;
  isPlaying: boolean;
  isBackgrounded: boolean;
}

/**
 * Shows accrued reward as both a visual (decorative `@yourtal/ui/progress`)
 * and a `role="status" aria-live="polite"` text region.
 *
 * The live region's text only changes on discrete events — a chapter
 * checkpoint being crossed, or a play-state/background transition — never
 * on every `video.timeupdate` tick (which fires several times a second).
 * That is what keeps announcements throttled: React only touches the DOM
 * text node when the rendered string actually differs, so an unmoved value
 * never re-announces.
 *
 * Copy is deliberately "so far" / provisional, never a completed-reward
 * claim: per docs/06-longform-video-and-attention.md §5, the reward is
 * only confirmed once the (separately built, YT-0413) checkpoint exchanges
 * a signed token — this indicator is a progress display, not evidence of a
 * finalized reward. Likewise "paused" here is an honest UI state, not a
 * fraud signal — see use-tab-visibility.ts.
 */
export function AccrualIndicator({ accruedPoints, totalPoints, isPlaying, isBackgrounded }: AccrualIndicatorProps) {
  const isAccrualPaused = isPlaying && isBackgrounded;
  const roundedAccrued = Math.round(accruedPoints);
  const percentComplete = totalPoints > 0 ? Math.min(100, (accruedPoints / totalPoints) * 100) : 0;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-sans font-medium text-fg">Reward so far</span>
        <span className="text-sm font-sans font-semibold text-reward">
          {formatPoints(asDisplayPoints(roundedAccrued))}{" "}
          <span className="font-normal text-fg-subtle">/ {formatPoints(asDisplayPoints(totalPoints))}</span>
        </span>
      </div>
      {/* A plain element rather than @yourtal/ui/progress: this bar is
          non-interactive, and Radix Progress plus its Primitive dependency
          cost ~8 KB gz here, which put this route over the 170 KB
          initial-JS gate (docs/13b section 8). `role="progressbar"` with
          explicit aria-value* is exactly what Radix renders, so a screen
          reader sees no difference. */}
      <div
        role="progressbar"
        aria-label="Reward earned so far"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percentComplete)}
        className="h-2 w-full overflow-hidden rounded-full bg-surface-raised"
      >
        <div className="h-full bg-reward transition-all" style={{ width: `${percentComplete}%` }} />
      </div>
      <p role="status" aria-live="polite" className="text-xs font-sans text-fg-muted">
        {isAccrualPaused
          ? "Reward accrual paused — this tab is in the background."
          : `Earned ${formatPoints(asDisplayPoints(roundedAccrued))} so far, pending the checkpoint.`}
      </p>
    </div>
  );
}
