"use client";

import { asDisplayPoints, formatPoints } from "@yourtal/contracts/money/format";

export interface AccrualIndicatorProps {
  accruedPoints: number;
  totalPoints: number;
  isPlaying: boolean;
  isBackgrounded: boolean;
  /** YT-0405: defaults to "id-ID" so existing callers are unaffected. */
  locale?: "en-AU" | "id-ID";
}

/**
 * Progress toward the reward — deliberately NOT a running balance.
 *
 * Decision O-1 (docs/16-decisions.md, 2026-09-20, superseding
 * docs/06-longform-video-and-attention.md §3 and §5): the reward is granted
 * only if the user watches the FULL video AND answers the checkpoint
 * questions. All or nothing — quitting at minute 28 of 30 earns nothing.
 * O-2's consequence: chapters and this indicator are a **progress and
 * navigation device, not an accrual device**. Progress is shown, value is
 * not credited until the end.
 *
 * This component previously read "Reward so far" over a live point tally
 * (`accruedPoints`) that grew as chapters were reached and used the word
 * "earned" — exactly the misleading pattern O-1 exists to prevent: a user
 * who believes they are banking points and then gets nothing at minute 28
 * is the worst experience this product can produce. The fix keeps the same
 * props (`accruedPoints`/`totalPoints` still drive the bar's fill, computed
 * upstream from the back-loaded chapter curve in derive-chapters.ts) but
 * never renders `accruedPoints` as a number, and never uses "earned" or
 * "so far" as if it were banked. Only the total — the one figure that is
 * ever actually paid — is shown as text.
 */
export function AccrualIndicator({
  accruedPoints,
  totalPoints,
  isPlaying,
  isBackgrounded,
  locale = "id-ID",
}: AccrualIndicatorProps) {
  const isAccrualPaused = isPlaying && isBackgrounded;
  const percentComplete = totalPoints > 0 ? Math.min(100, (accruedPoints / totalPoints) * 100) : 0;
  const totalLabel = formatPoints(asDisplayPoints(totalPoints), locale);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-sans font-medium text-fg">Reward if you finish</span>
        <span className="text-sm font-sans font-semibold text-reward">{totalLabel}</span>
      </div>
      {/* A plain element rather than @yourtal/ui/progress: this bar is
          non-interactive, and Radix Progress plus its Primitive dependency
          cost ~8 KB gz here, which put this route over the 170 KB
          initial-JS gate (docs/13b section 8). `role="progressbar"` with
          explicit aria-value* is exactly what Radix renders, so a screen
          reader sees no difference. */}
      <div
        role="progressbar"
        aria-label="Progress toward the reward"
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
          : `Nothing is paid until you finish the whole video and answer the checkpoint questions — then you receive ${totalLabel}.`}
      </p>
    </div>
  );
}
