import type { Balance } from "@yourtal/contracts/balance";
import type { Voucher } from "@yourtal/contracts/voucher";
import type { WalletHistoryEntry } from "./wallet-history";
import { WalletBalanceSummary } from "./wallet-balance-summary";
import { WalletEmptyState } from "./wallet-empty-state";
import { WalletVoucherList } from "./wallet-voucher-list";
import { WalletHistoryList } from "./wallet-history-list";

export interface WalletScreenProps {
  balance: Balance;
  vouchers: Voucher[];
  history: WalletHistoryEntry[];
  nowMs: number;
}

function isWalletEmpty(balance: Balance, vouchers: Voucher[]): boolean {
  return balance.availablePoints === 0 && balance.pendingPoints === 0 && balance.expiringPoints === 0 && vouchers.length === 0;
}

/**
 * Composes the Wallet surface (YT-0423): balance, vouchers, then history —
 * the order docs/17-surfaces-and-roles.md §3 lays the three answers out in
 * ("what do I have, what's coming, what am I about to lose"), followed by
 * the vouchers those points bought and the plain-language history of how
 * they moved.
 */
export function WalletScreen({ balance, vouchers, history, nowMs }: WalletScreenProps) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4">
      <h1 className="text-2xl font-semibold text-fg">Wallet</h1>
      {isWalletEmpty(balance, vouchers) ? <WalletEmptyState /> : <WalletBalanceSummary balance={balance} nowMs={nowMs} />}
      <WalletVoucherList vouchers={vouchers} nowMs={nowMs} />
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-fg">Riwayat poin</h2>
        <WalletHistoryList entries={history} />
      </section>
    </div>
  );
}
