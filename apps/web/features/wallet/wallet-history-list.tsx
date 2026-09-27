import { getTranslations } from "next-intl/server";
import type { WalletHistoryEntry } from "@yourtal/contracts/wallet/history";
import { formatPointsIn } from "@yourtal/contracts/money/money-format";
import { Text } from "@yourtal/ui/text";
import type { SupportedLocale } from "./wallet-format";
import { formatWalletDate } from "./wallet-format";
import { describeHistoryEntry } from "./wallet-history-copy";

export interface WalletHistoryListProps {
  entries: WalletHistoryEntry[];
  locale: SupportedLocale;
}

const SIGN_FORMATTERS: Record<SupportedLocale, Intl.NumberFormat> = {
  "en-AU": new Intl.NumberFormat("en-AU", { signDisplay: "exceptZero" }),
  "id-ID": new Intl.NumberFormat("id-ID", { signDisplay: "exceptZero" }),
};

/**
 * Points history in plain language (6.5.a) — every row reads as a sentence
 * about what happened, built from `entry.kind` in this feature's own
 * catalogue (`wallet-history-copy.ts`), never a bare transaction code.
 */
export async function WalletHistoryList({ entries, locale }: WalletHistoryListProps) {
  const t = await getTranslations("wallet");

  if (entries.length === 0) {
    return <Text tone="muted">{t("history.empty")}</Text>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {entries.map((entry) => {
        // `Number(...)` first: negating the branded `Points` type directly
        // is what `@typescript-eslint/no-unsafe-unary-minus` objects to
        // (points-price-from-settlement.ts and wallet-mapping.ts use the
        // same pattern for the same reason — a signed delta is a display
        // concern, not something the branded type itself needs to allow).
        const signedAmount =
          entry.direction === "debit" ? -Number(entry.points) : Number(entry.points);
        return (
          <li
            key={entry.id}
            className="flex items-start justify-between gap-3 border-b border-border-subtle pb-3 last:border-none last:pb-0"
          >
            <div className="min-w-0">
              <Text size="body-sm">
                {describeHistoryEntry(entry.kind, formatPointsIn(locale, entry.points), t)}
              </Text>
              <Text tone="subtle" size="caption">
                {formatWalletDate(entry.occurredAt, locale)}
              </Text>
            </div>
            <span
              className={`shrink-0 text-numeric text-body-sm font-semibold ${entry.direction === "credit" ? "text-success-solid" : "text-fg-muted"}`}
            >
              {SIGN_FORMATTERS[locale].format(signedAmount)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
