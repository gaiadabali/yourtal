import type { Balance } from "@yourtal/contracts/balance";
import { formatPoints } from "@yourtal/contracts/money/format";
import { Card, CardContent } from "@yourtal/ui/card";
import { formatRelativeToNow, formatWalletDate } from "./wallet-format";

export interface WalletBalanceSummaryProps {
  balance: Balance;
  nowMs: number;
}

/**
 * Answers the three questions docs/17-surfaces-and-roles.md §3 says the
 * Wallet exists to answer: what do I have, what's coming, what am I about
 * to lose. Each is its own row so none can be missed or buried inside one
 * combined number — the "pending" and "expiring" rows always show their
 * date (`pendingUnlockAt` / `expiringAt`), never just an amount.
 */
export function WalletBalanceSummary({ balance, nowMs }: WalletBalanceSummaryProps) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-6">
        <div>
          <p className="text-xs text-fg-subtle">Saldo tersedia</p>
          <p className="text-3xl font-semibold text-reward">{formatPoints(balance.availablePoints)}</p>
        </div>
        <dl className="grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-fg-subtle">Menunggu pencairan</dt>
            <dd className="text-sm font-medium text-fg">
              {balance.pendingPoints > 0 && balance.pendingUnlockAt
                ? `${formatPoints(balance.pendingPoints)} · cair ${formatWalletDate(balance.pendingUnlockAt)} (${formatRelativeToNow(balance.pendingUnlockAt, nowMs)})`
                : "Tidak ada poin tertahan"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-fg-subtle">Akan kedaluwarsa</dt>
            <dd className={`text-sm font-medium ${balance.expiringPoints > 0 ? "text-warning" : "text-fg"}`}>
              {balance.expiringPoints > 0 && balance.expiringAt
                ? `${formatPoints(balance.expiringPoints)} · kedaluwarsa ${formatWalletDate(balance.expiringAt)} (${formatRelativeToNow(balance.expiringAt, nowMs)})`
                : "Tidak ada poin yang akan hangus"}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
