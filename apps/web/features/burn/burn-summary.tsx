"use client";

import { useTranslations } from "next-intl";
import type { Listing } from "@yourtal/contracts/listing";
import {
  asDisplayIdr,
  asDisplayPoints,
  formatMoney,
  formatPoints,
} from "@yourtal/contracts/money/format";
import { Badge } from "@yourtal/ui/badge";
import { useRegion } from "@/features/region/use-region";

export interface BurnSummaryProps {
  listing: Listing;
  /**
   * Controls only the heading — the figures below never differ between the
   * two, because "the confirmation step restates cost and terms"
   * (docs/tasks/phase-u-ui.md YT-0422) means literally the same numbers,
   * not a re-derived approximation.
   */
  variant?: "review" | "confirmation";
}

/**
 * Restates the points cost, the face value, what the user gets, and the
 * terms that bind — the same four things whether this is the initial
 * review or the final confirmation (docs/tasks/phase-u-ui.md YT-0422's
 * second acceptance criterion). Money is rendered via
 * `@yourtal/contracts/money/format`'s display-only helpers, never a
 * hand-formatted string, and never the full Zod `money` module (that would
 * pull ~100 KB gz into this client-reachable component — docs/13b §8).
 *
 * YT-0405: a Client Component (its only consumer, `burn-flow.tsx`, is
 * already `"use client"`), so it reads the active region and its
 * translations ambiently via `useRegion()`/`useTranslations()` — the face
 * value and minimum spend render via `formatMoney` in the region's real
 * currency, never a hardcoded `formatIdr`/`Rp`.
 */
export function BurnSummary({ listing, variant = "review" }: BurnSummaryProps) {
  const { locale, currency } = useRegion();
  const t = useTranslations("burn");
  const partialRedemptionCopy: Record<Listing["partialRedemptionPolicy"], string> = {
    balance_carrying: t("summary.balanceCarrying"),
    single_use_forfeit: t("summary.singleUseForfeit"),
    minimum_spend: t("summary.minimumSpendPolicy"),
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-sans font-semibold text-fg">
          {variant === "confirmation" ? t("summary.confirmHeading") : t("summary.reviewHeading")}
        </h2>
        <Badge variant="outline">{listing.merchantName}</Badge>
      </div>
      <p className="text-base font-sans font-medium text-fg">{listing.title}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm font-sans">
        <dt className="text-fg-muted">{t("summary.pointsCost")}</dt>
        <dd className="text-right font-semibold text-price">
          {formatPoints(asDisplayPoints(listing.priceInPoints), locale)}
        </dd>
        <dt className="text-fg-muted">{t("summary.voucherValue")}</dt>
        <dd className="text-right text-fg">
          {formatMoney(asDisplayIdr(listing.faceValueIdr), currency)}
        </dd>
        <dt className="text-fg-muted">{t("summary.youGet")}</dt>
        <dd className="text-right text-fg">
          {t("summary.voucherFor", { merchantName: listing.merchantName })}
        </dd>
        {listing.minimumSpendIdr !== null ? (
          <>
            <dt className="text-fg-muted">{t("summary.minimumSpend")}</dt>
            <dd className="text-right text-fg">
              {formatMoney(asDisplayIdr(listing.minimumSpendIdr), currency)}
            </dd>
          </>
        ) : null}
      </dl>
      <p className="text-xs font-sans text-fg-subtle">
        {listing.transferable ? t("summary.transferableOnce") : t("summary.notTransferable")}
        {partialRedemptionCopy[listing.partialRedemptionPolicy]}
      </p>
    </div>
  );
}
