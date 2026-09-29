import { useFormatter, useTranslations } from "next-intl";
import type { WalletPending } from "@yourtal/contracts/wallet/wallet";
import { formatFeedPoints, type FeedLocale } from "./feed-terms";

export interface StreakStripProps {
  days: number;
  pending: readonly WalletPending[];
  locale: FeedLocale;
}

const MAX_PENDING_SHOWN = 3;

/** The streak, and each pending grant with its own unlock date (11.4.c). Never names a tier. */
export function StreakStrip({ days, pending, locale }: StreakStripProps) {
  const t = useTranslations("feed");
  const format = useFormatter();
  return (
    <section
      aria-label={t("streak.label")}
      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-card bg-surface-sunken px-4 py-3 text-body-sm font-sans"
    >
      <span className="font-semibold text-fg">
        {days > 0 ? t("streak.days", { count: days }) : t("streak.start")}
      </span>
      {pending.slice(0, MAX_PENDING_SHOWN).map((grant) => (
        <span key={`${grant.unlockAt}-${grant.points}`} className="text-fg-muted">
          {t("streak.pending", {
            points: formatFeedPoints(locale, grant.points),
            date: format.dateTime(new Date(grant.unlockAt), { day: "numeric", month: "short" }),
          })}
        </span>
      ))}
    </section>
  );
}
