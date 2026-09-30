import { getTranslations } from "next-intl/server";
import { ArrowDownLeft, ArrowUpRight, RotateCcw } from "lucide-react";
import type { WalletHistoryEntry } from "@yourtal/contracts/wallet/history";
import type { Region } from "@yourtal/contracts/region";
import { asDisplayPoints, formatPointsIn } from "@yourtal/contracts/money/format";
import { cn } from "@yourtal/ui/cn";
import { describeHistoryEntry } from "./wallet-history-copy";
import type { SupportedLocale } from "./wallet-format";

export const HISTORY_FILTERS = ["all", "earned", "redeemed", "returned"] as const;
export type HistoryFilter = (typeof HISTORY_FILTERS)[number];

export function matchesHistoryFilter(entry: WalletHistoryEntry, filter: HistoryFilter): boolean {
  switch (filter) {
    case "earned":
      return entry.kind === "earn";
    case "redeemed":
      return entry.kind === "burn";
    case "returned":
      return entry.kind === "reversal" && entry.direction === "credit";
    default:
      return true;
  }
}

const TIME_ZONE: Record<Region, string> = { AU: "Australia/Sydney", ID: "Asia/Jakarta" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where a line leads: an earn to its video, a redemption to its voucher. */
function linkFor(entry: WalletHistoryEntry): string | null {
  if (!entry.relatedId || !UUID.test(entry.relatedId)) return null;
  if (entry.kind === "earn") return `/watch/${entry.relatedId}`;
  if (entry.kind === "burn") return `/wallet/voucher/${entry.relatedId}`;
  return null;
}

export interface WalletHistoryProps {
  entries: readonly WalletHistoryEntry[];
  filter: HistoryFilter;
  filterHref: (filter: HistoryFilter) => string;
  olderHref: string | null;
  region: Region;
  locale: SupportedLocale;
  nowMs: number;
}

/** 13.19.d: points history by day on the region's clock, with filters. */
export async function WalletHistory({
  entries,
  filter,
  filterHref,
  olderHref,
  region,
  locale,
  nowMs,
}: WalletHistoryProps) {
  const t = await getTranslations("wallet");
  const zone = TIME_ZONE[region];
  const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: zone });
  const dayLabel = new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
  });
  const today = dayKey.format(new Date(nowMs));
  const yesterday = dayKey.format(new Date(nowMs - 86_400_000));

  const groups = new Map<string, WalletHistoryEntry[]>();
  for (const entry of entries.filter((row) => matchesHistoryFilter(row, filter))) {
    const key = dayKey.format(new Date(entry.occurredAt));
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }

  return (
    <section aria-labelledby="wallet-history" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="wallet-history" className="font-display text-headline font-bold text-fg">
          {t("screen.historyHeading")}
        </h2>
        <nav aria-label={t("overview.historyFilters")} className="flex flex-wrap gap-2">
          {HISTORY_FILTERS.map((value) => (
            <a
              key={value}
              href={filterHref(value)}
              aria-current={filter === value ? "page" : undefined}
              className={cn(
                "inline-flex h-8 items-center rounded-control px-3 text-label font-sans font-semibold",
                filter === value
                  ? "bg-fg text-canvas"
                  : "bg-surface-sunken text-fg hover:bg-border-subtle",
              )}
            >
              {t(`overview.filter.${value}`)}
            </a>
          ))}
        </nav>
      </div>

      {groups.size === 0 ? (
        <p className="rounded-card border border-dashed border-border-subtle p-6 text-body-sm font-sans text-fg-muted">
          {t("history.empty")}
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {[...groups].map(([key, rows]) => (
            <div key={key} className="flex flex-col gap-1">
              <h3 className="text-label font-sans font-semibold text-fg-muted">
                {key === today
                  ? t("overview.today")
                  : key === yesterday
                    ? t("overview.yesterday")
                    : dayLabel.format(new Date(rows[0]?.occurredAt ?? nowMs))}
              </h3>
              <ul className="divide-y divide-border-subtle overflow-hidden rounded-card border border-border-subtle bg-surface">
                {rows.map((entry) => {
                  const credit = entry.direction === "credit";
                  const amount = formatPointsIn(locale, asDisplayPoints(entry.points));
                  const href = linkFor(entry);
                  const Icon =
                    entry.kind === "reversal" ? RotateCcw : credit ? ArrowDownLeft : ArrowUpRight;
                  const body = (
                    <>
                      <span
                        aria-hidden="true"
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-full",
                          credit
                            ? "bg-success-subtle text-success-on-subtle"
                            : "bg-surface-sunken text-fg-muted",
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-body-sm font-sans font-medium text-fg">
                          {describeHistoryEntry(entry.kind, amount, t)}
                        </span>
                        <span className="text-caption font-sans text-fg-subtle">
                          {time.format(new Date(entry.occurredAt))}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "shrink-0 text-body-sm font-sans font-bold tabular-nums",
                          credit ? "text-success-solid" : "text-fg",
                        )}
                      >
                        {credit ? "+" : "−"}
                        {amount}
                      </span>
                    </>
                  );
                  return (
                    <li key={entry.id}>
                      {href ? (
                        <a
                          href={href}
                          className="flex items-center gap-3 px-4 py-3 hover:bg-surface-sunken focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
                        >
                          {body}
                        </a>
                      ) : (
                        <div className="flex items-center gap-3 px-4 py-3">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
      {olderHref ? (
        <a
          href={olderHref}
          className="w-fit text-label font-sans font-semibold text-accent hover:underline"
        >
          {t("overview.older")}
        </a>
      ) : null}
    </section>
  );
}
