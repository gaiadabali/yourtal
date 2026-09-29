"use client";

import { useLocale, useTranslations } from "next-intl";
import type { PublicListing } from "@yourtal/contracts/listing";
import type { Points } from "@yourtal/contracts/money";
import {
  asDisplayIdr,
  asDisplayPoints,
  formatMoney,
  formatPointsIn,
} from "@yourtal/contracts/money/format";
import type { DisplayLocale } from "@yourtal/contracts/identity/user-profile";
import { Badge } from "@yourtal/ui/badge";

export interface BurnSummaryProps {
  listing: PublicListing;
  /**
   * 11.6.b: the checkout's own LOCKED price (`POST /api/checkout/quote`'s
   * `pricePoints`), not `listing.priceInPoints` re-read from the catalogue —
   * a listing's live price can move between quoting and this render (a rate
   * change, a re-quote), and "the confirmation step restates cost and
   * terms" (docs/09 §4.2) means the price that will actually be charged.
   * Defaults to the listing's own price for a caller with no quote yet.
   */
  pricePoints?: Points;
  /**
   * Controls only the heading — the figures below never differ between the
   * two, because "the confirmation step restates cost and terms"
   * (docs/09 §4.2) means literally the same numbers, not a re-derived
   * approximation.
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
 * A Client Component (its only consumer, `burn-flow.tsx`, is already
 * `"use client"`), so it reads its display language ambiently via
 * `useLocale()`/`useTranslations()` (6.1.b) — the face value and minimum
 * spend render via `formatMoney` in the LISTING's own currency (never the
 * viewer's region or display language), never a hardcoded `formatIdr`/`Rp`.
 */
export function BurnSummary({
  listing,
  pricePoints = listing.priceInPoints,
  variant = "review",
}: BurnSummaryProps) {
  const locale = useLocale() as DisplayLocale;
  const t = useTranslations("burn");
  const partialRedemptionCopy: Record<PublicListing["partialRedemptionPolicy"], string> = {
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
          {formatPointsIn(locale, asDisplayPoints(pricePoints))}
        </dd>
        <dt className="text-fg-muted">{t("summary.voucherValue")}</dt>
        <dd className="text-right text-fg">
          {formatMoney(asDisplayIdr(listing.faceValueMinor), listing.currency)}
        </dd>
        <dt className="text-fg-muted">{t("summary.youGet")}</dt>
        <dd className="text-right text-fg">
          {t("summary.voucherFor", { merchantName: listing.merchantName })}
        </dd>
        {listing.minimumSpendMinor !== null ? (
          <>
            <dt className="text-fg-muted">{t("summary.minimumSpend")}</dt>
            <dd className="text-right text-fg">
              {formatMoney(asDisplayIdr(listing.minimumSpendMinor), listing.currency)}
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
