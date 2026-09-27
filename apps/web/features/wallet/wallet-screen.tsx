import { getTranslations } from "next-intl/server";
import type { WalletSummary } from "@yourtal/contracts/wallet/wallet";
import type { WalletHistoryEntry } from "@yourtal/contracts/wallet/history";
import { PageContainer } from "@yourtal/ui/page-container";
import { PageHeader } from "@yourtal/ui/page-header";
import { Section } from "@yourtal/ui/section";
import type { WalletVoucherDetail } from "./wallet-data";
import { WalletBalanceSummary } from "./wallet-balance-summary";
import { WalletEmptyState } from "./wallet-empty-state";
import { WalletVoucherList } from "./wallet-voucher-list";
import { WalletHistoryList } from "./wallet-history-list";
import type { SupportedLocale } from "./wallet-format";

export interface WalletScreenProps {
  balance: WalletSummary;
  vouchers: WalletVoucherDetail[];
  history: WalletHistoryEntry[];
  nowMs: number;
  locale: SupportedLocale;
}

function isWalletEmpty(balance: WalletSummary, vouchers: WalletVoucherDetail[]): boolean {
  return (
    balance.availablePoints === 0 &&
    balance.pendingPoints === 0 &&
    balance.expiringPoints === 0 &&
    vouchers.length === 0
  );
}

/**
 * Composes the Wallet surface (6.5): balance, vouchers, then history — the
 * order docs/17-surfaces-and-roles.md §3 lays the three answers out in
 * ("what do I have, what's coming, what am I about to lose"), followed by
 * the vouchers those points bought and the plain-language history of how
 * they moved.
 *
 * Every child here (`WalletBalanceSummary`, `WalletEmptyState`,
 * `WalletVoucherList`, `WalletHistoryList`) is itself an async Server
 * Component (each calls `getTranslations` on its own). They are called and
 * awaited directly rather than left as `<Child .../>` JSX: Next's real RSC
 * pipeline resolves nested async components either way, but a plain client
 * renderer (react-dom, and therefore this feature's own tests) does not —
 * awaiting explicitly makes the composition work, and be testable, under
 * both.
 */
export async function WalletScreen({
  balance,
  vouchers,
  history,
  nowMs,
  locale,
}: WalletScreenProps) {
  const t = await getTranslations("wallet");
  const empty = isWalletEmpty(balance, vouchers);
  const [balanceOrEmptyState, voucherList, historyList] = await Promise.all([
    empty ? WalletEmptyState() : WalletBalanceSummary({ balance, nowMs, locale }),
    WalletVoucherList({ vouchers, nowMs, locale }),
    WalletHistoryList({ entries: history, locale }),
  ]);

  return (
    <PageContainer width="narrow" className="flex flex-col gap-6 py-6">
      <PageHeader title={t("screen.title")} />
      {balanceOrEmptyState}
      {voucherList}
      <Section title={t("screen.historyHeading")}>{historyList}</Section>
    </PageContainer>
  );
}
