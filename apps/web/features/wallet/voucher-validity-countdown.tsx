"use client";

import { useTranslations } from "next-intl";

export interface VoucherValidityCountdownProps {
  secondsUntilRotation: number;
  rotationIntervalSeconds: number;
}

/**
 * Visible validity countdown for the rotating QR (YT-0424). A native
 * `role="progressbar"` div rather than `@yourtal/ui/progress` (Radix) — a
 * countdown bar needs neither a focus trap nor a portal, and
 * docs/13b-typescript-standards.md §8 rule 4 prefers native controls for
 * exactly this case.
 */
export function VoucherValidityCountdown({
  secondsUntilRotation,
  rotationIntervalSeconds,
}: VoucherValidityCountdownProps) {
  const t = useTranslations("wallet");
  const clampedSeconds = Math.max(0, Math.min(secondsUntilRotation, rotationIntervalSeconds));
  const percentRemaining = Math.round((clampedSeconds / rotationIntervalSeconds) * 100);

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs text-fg-muted">
        <span>{t("voucher.codeAutoRefresh")}</span>
        <span className="tabular-nums">
          {t("voucher.secondsRemaining", { seconds: clampedSeconds })}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={t("voucher.refreshCountdownLabel")}
        aria-valuemin={0}
        aria-valuemax={rotationIntervalSeconds}
        aria-valuenow={clampedSeconds}
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-raised"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 ease-linear"
          style={{ width: `${percentRemaining}%` }}
        />
      </div>
    </div>
  );
}
