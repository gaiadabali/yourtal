import { formatMerchantMoney } from "./merchant-money";
import { Badge } from "@yourtal/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import type { MerchantLogEntry } from "./merchant-today-log";
import { confirmedRunningTotal, pendingEntries } from "./merchant-today-log";
import type { MerchantCopy } from "./merchant-copy";
import type { MerchantCurrency, MerchantLocale } from "./merchant-device";

export interface MerchantTodayLogPanelProps {
  entries: readonly MerchantLogEntry[];
  locale: MerchantLocale;
  currency: MerchantCurrency;
  copy: MerchantCopy;
}

/**
 * This ticket's fourth acceptance criterion: today's redemptions with a
 * running total — scoped to `policies/resource_policies/redemption.yaml`'s
 * `counter-device-sees-today-only` rule (a counter device's `view_log` is
 * only ever "today"). The running total counts CONFIRMED captures only
 * (`confirmedRunningTotal`, in `merchant-today-log.ts`) — a pending entry
 * is not yet real money moved, so folding it into the total would
 * overstate what has actually settled, the same honesty rule that governs
 * every other part of this feature.
 */
export function MerchantTodayLogPanel({
  entries,
  locale,
  currency,
  copy,
}: MerchantTodayLogPanelProps) {
  const total = confirmedRunningTotal(entries);
  const pending = pendingEntries(entries);
  const sorted = [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <Card>
      <CardHeader className="flex-row items-baseline justify-between">
        <CardTitle as="h2" className="text-base">
          {copy.todayHeading}
        </CardTitle>
        <div className="text-right">
          <p className="text-lg font-sans font-semibold tabular-nums text-fg">
            {formatMerchantMoney(total, currency)}
          </p>
          {pending.length > 0 ? (
            <p className="text-xs font-sans text-warning">
              {pending.length} {copy.todayPendingLabel}
            </p>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="text-sm font-sans text-fg-muted">{copy.todayEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sorted.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between border-b border-border pb-2 text-sm last:border-b-0"
              >
                <div className="flex flex-col">
                  <span className="font-mono text-fg">{entry.voucherCode}</span>
                  <span className="text-xs text-fg-muted">
                    {formatEntryTime(entry.createdAt, locale)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="tabular-nums text-fg">
                    {formatMerchantMoney(entry.amountMinor, currency)}
                  </span>
                  {entry.status === "pending" ? (
                    <Badge variant="warning">{copy.todayStatusPending}</Badge>
                  ) : null}
                  {entry.status === "failed" ? (
                    <Badge variant="danger">{copy.todayStatusFailed}</Badge>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function formatEntryTime(iso: string, locale: MerchantLocale): string {
  return new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(new Date(iso));
}
