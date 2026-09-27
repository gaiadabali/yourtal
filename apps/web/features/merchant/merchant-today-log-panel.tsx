import type { CounterLogEntry } from "@yourtal/contracts/device/counter-redemption";
import { formatMerchantMoney } from "./merchant-money";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import type { MerchantCopy } from "./merchant-i18n";
import type { MerchantLocale } from "./merchant-device";

export interface MerchantTodayLogPanelProps {
  entries: readonly CounterLogEntry[];
  locale: MerchantLocale;
  copy: MerchantCopy;
}

/**
 * Today's redemptions with a running total, scoped to
 * `policies/resource_policies/redemption.yaml`'s `counter-device-sees-
 * today-only` rule. TASKS.md 8.2 REWRITE: `entries` is now the server's own
 * answer (`GET /api/counter/log`), so every one of them is a real,
 * confirmed capture — there is no "pending" or "failed" status left to
 * show (those never made it into the server's log at all).
 */
export function MerchantTodayLogPanel({ entries, locale, copy }: MerchantTodayLogPanelProps) {
  const total = entries.reduce((sum, entry) => sum + entry.amountMinor, 0);
  const sorted = [...entries].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  const currency = entries[0]?.currency ?? "AUD";

  return (
    <Card>
      <CardHeader className="flex-row items-baseline justify-between">
        <CardTitle as="h2" className="text-base">
          {copy.todayHeading}
        </CardTitle>
        <p className="text-lg font-sans font-semibold tabular-nums text-fg">
          {formatMerchantMoney(total, currency)}
        </p>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="text-sm font-sans text-fg-muted">{copy.todayEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sorted.map((entry) => (
              <li
                key={entry.captureId}
                className="flex items-center justify-between border-b border-border pb-2 text-sm last:border-b-0"
              >
                <div className="flex flex-col">
                  <span className="font-mono text-fg">{entry.orderRef}</span>
                  <span className="text-xs text-fg-muted">
                    {formatEntryTime(entry.capturedAt, locale)}
                  </span>
                </div>
                <span className="tabular-nums text-fg">
                  {formatMerchantMoney(entry.amountMinor, entry.currency)}
                </span>
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
