import { getTranslations } from "next-intl/server";
import type { WalletSummary } from "@yourtal/contracts/wallet/wallet";
import { PointsChip } from "@yourtal/ui/points-chip";
import { Heading } from "@yourtal/ui/heading";
import { Text } from "@yourtal/ui/text";
import type { SupportedLocale } from "./wallet-format";
import { formatRelativeToNow, formatWalletDate } from "./wallet-format";

export interface WalletBalanceSummaryProps {
  balance: WalletSummary;
  nowMs: number;
  locale: SupportedLocale;
}

/**
 * Answers the three questions the wallet exists to answer (6.5.a): what do I
 * have, what's coming, what am I about to lose. Pending is one row PER
 * GRANT — the live `GET /api/wallet` (4.8.a) already gives each hold its own
 * `unlockAt`, so this never collapses them into a single soonest-date line
 * the way the old fixture-driven card did. Expiring only ever renders when
 * `expiringPoints > 0` — points-expiry is off by default per region (F2),
 * so an expiring row is simply absent for a region/account with it off.
 */
export async function WalletBalanceSummary({ balance, nowMs, locale }: WalletBalanceSummaryProps) {
  const t = await getTranslations("wallet");

  return (
    <div className="flex flex-col gap-4 rounded-card border border-border-subtle bg-surface p-6">
      <div>
        <Text tone="muted" size="body-sm">
          {t("balance.available")}
        </Text>
        <div className="mt-1">
          <PointsChip
            value={balance.availablePoints}
            size="lg"
            locale={locale}
            formatLabel={(formatted) => t("balance.availableLabel", { amount: formatted })}
          />
        </div>
      </div>

      {balance.pending.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-border-subtle pt-4">
          <Heading level={3} size="title">
            {t("balance.pendingLabel")}
          </Heading>
          <ul className="flex flex-col gap-2">
            {balance.pending.map((grant) => (
              <li key={grant.unlockAt} className="flex items-center justify-between gap-3 text-body-sm">
                <PointsChip
                  value={grant.points}
                  size="sm"
                  locale={locale}
                  formatLabel={(formatted) => t("balance.pendingGrantLabel", { amount: formatted })}
                />
                <Text tone="muted" size="body-sm">
                  {t("balance.unlocksOn", {
                    date: formatWalletDate(grant.unlockAt, locale),
                    relative: formatRelativeToNow(grant.unlockAt, nowMs, locale),
                  })}
                </Text>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {balance.expiringPoints > 0 && balance.expiringAt ? (
        <div className="flex items-center justify-between gap-3 border-t border-border-subtle pt-4">
          <PointsChip
            value={balance.expiringPoints}
            size="sm"
            locale={locale}
            formatLabel={(formatted) => t("balance.expiringLabel", { amount: formatted })}
          />
          <Text tone="danger" size="body-sm">
            {t("balance.expiresOn", {
              date: formatWalletDate(balance.expiringAt, locale),
              relative: formatRelativeToNow(balance.expiringAt, nowMs, locale),
            })}
          </Text>
        </div>
      ) : null}
    </div>
  );
}
