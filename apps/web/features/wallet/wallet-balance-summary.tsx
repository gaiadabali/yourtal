import type { Balance } from "@yourtal/contracts/balance";
import { formatPoints } from "@yourtal/contracts/money/format";
import { Card, CardContent } from "@yourtal/ui/card";
import { formatRelativeToNow, formatWalletDate } from "./wallet-format";
import { getWalletTranslator, type SupportedLocale } from "./wallet-i18n";

export interface WalletBalanceSummaryProps {
  balance: Balance;
  nowMs: number;
  /** YT-0405: defaults to "id-ID" so existing callers are unaffected. */
  locale?: SupportedLocale;
}

/**
 * Answers the three questions docs/17-surfaces-and-roles.md §3 says the
 * Wallet exists to answer: what do I have, what's coming, what am I about
 * to lose. Each is its own row so none can be missed or buried inside one
 * combined number — the "pending" and "expiring" rows always show their
 * date (`pendingUnlockAt` / `expiringAt`), never just an amount.
 */
export function WalletBalanceSummary({
  balance,
  nowMs,
  locale = "id-ID",
}: WalletBalanceSummaryProps) {
  const t = getWalletTranslator(locale);
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-6">
        <div>
          <p className="text-xs text-fg-subtle">{t("balance.available")}</p>
          <p className="text-3xl font-semibold text-reward">
            {formatPoints(balance.availablePoints, locale)}
          </p>
        </div>
        <dl className="grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-fg-subtle">{t("balance.pendingLabel")}</dt>
            <dd className="text-sm font-medium text-fg">
              {balance.pendingPoints > 0 && balance.pendingUnlockAt
                ? t("balance.pendingWithDate", {
                    amount: formatPoints(balance.pendingPoints, locale),
                    date: formatWalletDate(balance.pendingUnlockAt, locale),
                    relative: formatRelativeToNow(balance.pendingUnlockAt, nowMs, locale),
                  })
                : t("balance.pendingNone")}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-fg-subtle">{t("balance.expiringLabel")}</dt>
            <dd
              className={`text-sm font-medium ${balance.expiringPoints > 0 ? "text-warning" : "text-fg"}`}
            >
              {balance.expiringPoints > 0 && balance.expiringAt
                ? t("balance.expiringWithDate", {
                    amount: formatPoints(balance.expiringPoints, locale),
                    date: formatWalletDate(balance.expiringAt, locale),
                    relative: formatRelativeToNow(balance.expiringAt, nowMs, locale),
                  })
                : t("balance.expiringNone")}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
