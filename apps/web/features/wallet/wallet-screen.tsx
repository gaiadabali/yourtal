import type { Balance } from "@yourtal/contracts/balance";
import type { Voucher } from "@yourtal/contracts/voucher";
import type { WalletHistoryEntry } from "./wallet-history";
import { WalletBalanceSummary } from "./wallet-balance-summary";
import { WalletEmptyState } from "./wallet-empty-state";
import { WalletVoucherList } from "./wallet-voucher-list";
import { WalletHistoryList } from "./wallet-history-list";
import { getWalletTranslator, type SupportedLocale } from "./wallet-i18n";

type SupportedCurrency = "AUD" | "IDR";

export interface WalletScreenProps {
  balance: Balance;
  vouchers: Voucher[];
  history: WalletHistoryEntry[];
  nowMs: number;
  /** YT-0405: required, not defaulted — see `store-balance-notice.tsx`'s report for why. */
  locale: SupportedLocale;
  currency: SupportedCurrency;
}

function isWalletEmpty(balance: Balance, vouchers: Voucher[]): boolean {
  return (
    balance.availablePoints === 0 &&
    balance.pendingPoints === 0 &&
    balance.expiringPoints === 0 &&
    vouchers.length === 0
  );
}

/**
 * Composes the Wallet surface (YT-0423): balance, vouchers, then history —
 * the order docs/17-surfaces-and-roles.md §3 lays the three answers out in
 * ("what do I have, what's coming, what am I about to lose"), followed by
 * the vouchers those points bought and the plain-language history of how
 * they moved.
 */
export function WalletScreen({
  balance,
  vouchers,
  history,
  nowMs,
  locale,
  currency,
}: WalletScreenProps) {
  const t = getWalletTranslator(locale);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4">
      <h1 className="text-2xl font-semibold text-fg">{t("screen.title")}</h1>
      {isWalletEmpty(balance, vouchers) ? (
        <WalletEmptyState locale={locale} />
      ) : (
        <WalletBalanceSummary balance={balance} nowMs={nowMs} locale={locale} />
      )}
      <WalletVoucherList vouchers={vouchers} nowMs={nowMs} locale={locale} currency={currency} />
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-fg">{t("screen.historyHeading")}</h2>
        <WalletHistoryList entries={history} locale={locale} />
      </section>
    </div>
  );
}
