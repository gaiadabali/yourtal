import type { WalletHistoryEntry } from "./wallet-history";
import { formatWalletDate } from "./wallet-format";

export interface WalletHistoryListProps {
  entries: WalletHistoryEntry[];
}

const pointsDeltaFormatter = new Intl.NumberFormat("id-ID", { signDisplay: "exceptZero" });

/**
 * Points history in plain language (YT-0423) — every row is
 * `entry.description`, a sentence about what happened, never a bare
 * transaction code. The signed amount is the only number shown alongside
 * it.
 */
export function WalletHistoryList({ entries }: WalletHistoryListProps) {
  if (entries.length === 0) {
    return <p className="text-sm text-fg-muted">Belum ada riwayat poin.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="flex items-start justify-between gap-3 border-b border-border pb-3 last:border-none last:pb-0"
        >
          <div>
            <p className="text-sm text-fg">{entry.description}</p>
            <p className="text-xs text-fg-subtle">{formatWalletDate(entry.occurredAt)}</p>
          </div>
          <span
            className={`shrink-0 text-sm font-semibold tabular-nums ${entry.pointsDelta >= 0 ? "text-reward" : "text-fg-muted"}`}
          >
            {pointsDeltaFormatter.format(entry.pointsDelta)}
          </span>
        </li>
      ))}
    </ul>
  );
}
