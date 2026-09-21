import type { WalletHistoryEntry } from "./wallet-history";
import { formatWalletDate } from "./wallet-format";
import { getWalletTranslator, type SupportedLocale } from "./wallet-i18n";

export interface WalletHistoryListProps {
  entries: WalletHistoryEntry[];
  /** YT-0405: required, not defaulted — see `store-balance-notice.tsx`'s report for why. */
  locale: SupportedLocale;
}

const POINTS_DELTA_FORMATTERS: Record<SupportedLocale, Intl.NumberFormat> = {
  "en-AU": new Intl.NumberFormat("en-AU", { signDisplay: "exceptZero" }),
  "id-ID": new Intl.NumberFormat("id-ID", { signDisplay: "exceptZero" }),
};

/**
 * Points history in plain language (YT-0423) — every row is
 * `entry.description`, a sentence about what happened, never a bare
 * transaction code. The signed amount is the only number shown alongside
 * it.
 */
export function WalletHistoryList({ entries, locale }: WalletHistoryListProps) {
  if (entries.length === 0) {
    return <p className="text-sm text-fg-muted">{getWalletTranslator(locale)("history.empty")}</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="flex items-start justify-between gap-3 border-b border-border pb-3 last:border-none last:pb-0"
        >
          {/* min-w-0: without it, this block's automatic minimum width
              (its longest unbreakable word) plus the shrink-0 amount span
              beside it can force the row wider than the viewport at
              narrow widths / 200% zoom (YT-0401). */}
          <div className="min-w-0">
            <p className="text-sm text-fg">{entry.description}</p>
            <p className="text-xs text-fg-subtle">{formatWalletDate(entry.occurredAt, locale)}</p>
          </div>
          <span
            className={`shrink-0 text-sm font-semibold tabular-nums ${entry.pointsDelta >= 0 ? "text-reward" : "text-fg-muted"}`}
          >
            {POINTS_DELTA_FORMATTERS[locale].format(entry.pointsDelta)}
          </span>
        </li>
      ))}
    </ul>
  );
}
