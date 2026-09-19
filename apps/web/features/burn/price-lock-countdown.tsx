"use client";

import { usePriceLockCountdown } from "./use-price-lock-countdown";
import { PRICE_LOCK_DURATION_MS } from "./price-lock";

export interface PriceLockCountdownProps {
  lockExpiresAt: string;
  onExpire: () => void;
}

const WARNING_THRESHOLD_SECONDS = 60;

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * The visible price-lock countdown — running from the moment the price is
 * first shown (docs/tasks/phase-u-ui.md YT-0422's first acceptance
 * criterion), because `lockExpiresAt` is computed server-side at render
 * time (see `page.tsx`) and this component only ever displays the gap to
 * it. See `use-price-lock-countdown.ts` for why that gap is recomputed from
 * the wall clock on every tick rather than counted down from mount.
 *
 * A plain `role="progressbar"` div rather than `@yourtal/ui/progress`
 * (Radix): this bar is non-interactive, and Radix Progress plus its
 * Primitive dependency is the exact cost that broke the initial-JS budget
 * on `/watch/[campaignId]` (see `features/player/accrual-indicator.tsx`) —
 * this route has far less budget headroom, so the same argument applies
 * even more strongly here.
 */
export function PriceLockCountdown({ lockExpiresAt, onExpire }: PriceLockCountdownProps) {
  const { secondsRemaining, isExpired, announcement } = usePriceLockCountdown(
    lockExpiresAt,
    onExpire,
  );
  const isRunningLow = !isExpired && secondsRemaining <= WARNING_THRESHOLD_SECONDS;
  const percentRemaining = Math.min(
    100,
    Math.max(0, (secondsRemaining * 1000 * 100) / PRICE_LOCK_DURATION_MS),
  );

  const containerTone = isExpired
    ? "border-danger bg-danger/10 text-danger"
    : isRunningLow
      ? "border-warning bg-warning/10 text-warning"
      : "border-price bg-price/10 text-price";
  const barTone = isExpired ? "bg-danger" : isRunningLow ? "bg-warning" : "bg-price";

  return (
    <div className={`flex flex-col gap-1.5 rounded-lg border px-3 py-2 ${containerTone}`}>
      <span
        role="timer"
        aria-label={
          isExpired
            ? "Harga sudah kedaluwarsa"
            : `Harga terkunci, sisa waktu ${formatClock(secondsRemaining)}`
        }
        className="text-sm font-sans font-medium tabular-nums"
      >
        {isExpired ? "Harga kedaluwarsa" : `Harga terkunci · ${formatClock(secondsRemaining)}`}
      </span>
      <div
        role="progressbar"
        aria-label="Sisa waktu kunci harga"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percentRemaining)}
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-raised"
      >
        <div
          className={`h-full transition-all ${barTone}`}
          style={{ width: `${percentRemaining}%` }}
        />
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
