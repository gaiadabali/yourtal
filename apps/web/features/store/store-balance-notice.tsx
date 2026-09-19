import Link from "next/link";
import type { Points } from "@yourtal/contracts/money";
import { formatPoints } from "@yourtal/contracts/money/format";
import { Button } from "@yourtal/ui/button";
import { computeBalanceShortfall } from "./store-balance";
import { getStoreTranslator, type SupportedLocale } from "./store-i18n";

export interface StoreBalanceNoticeProps {
  priceInPoints: Points;
  availablePoints: Points;
  /** YT-0405: defaults to "id-ID" so existing callers are unaffected. */
  locale?: SupportedLocale;
}

/**
 * The insufficient-balance state (YT-0421 acceptance: "shows exactly how
 * much more is needed and how to earn it"). `shortfallPoints` is a plain
 * arithmetic result, not a value that passed through the ledger's Zod
 * boundary; it is formatted with a plain `Intl.NumberFormat` rather than
 * `formatPoints` (YT-0405) because the `balance.insufficientHeading`
 * message already supplies its own unit word per locale ("poin" / "points")
 * — `formatPoints` would append a second one.
 *
 * "How to earn it" links to Earn (`/`) and Quick (`/quick`) rather than
 * computing a projected number of campaigns/days: that would require this
 * feature to depend on the earn-loop's own data shape and reward
 * distribution, which is out of scope for the store and would couple two
 * independently-owned features.
 */
export function StoreBalanceNotice({
  priceInPoints,
  availablePoints,
  locale = "id-ID",
}: StoreBalanceNoticeProps) {
  const shortfall = computeBalanceShortfall(priceInPoints, availablePoints);
  const t = getStoreTranslator(locale);

  if (shortfall.isAffordable) {
    return (
      <p className="text-sm text-success">
        {t("balance.sufficient", { amount: formatPoints(availablePoints, locale) })}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-surface px-3 py-3">
      <p className="text-sm font-medium text-fg">
        {t("balance.insufficientHeading", {
          count: new Intl.NumberFormat(locale).format(shortfall.shortfallPoints),
        })}
      </p>
      <p className="text-xs text-fg-muted">
        {t("balance.insufficientDetail", {
          available: formatPoints(availablePoints, locale),
          required: formatPoints(priceInPoints, locale),
        })}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="secondary">
          <Link href="/">{t("balance.earnAtEarn")}</Link>
        </Button>
        <Button asChild size="sm" variant="secondary">
          <Link href="/quick">{t("balance.tryQuick")}</Link>
        </Button>
      </div>
    </div>
  );
}
