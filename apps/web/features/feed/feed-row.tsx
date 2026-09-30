import { useTranslations } from "next-intl";
import { Badge } from "@yourtal/ui/badge";
import { MediaCard } from "@yourtal/ui/media-card";
import type { FeedRowItem } from "./feed-data";
import { formatFeedDuration, type FeedLocale } from "./feed-terms";

export interface FeedRowProps {
  title: string;
  empty: string;
  items: readonly FeedRowItem[];
  locale: FeedLocale;
}

/** A Home row (11.4.c): a grid on phones, a horizontal shelf on desktop. */
export function FeedRow({ title, empty, items }: FeedRowProps) {
  const t = useTranslations("feed");
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h2 className="font-display text-title font-bold text-fg">{title}</h2>
      {items.length === 0 ? (
        <p className="text-body-sm font-sans text-fg-muted">{empty}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 lg:flex lg:gap-4 lg:overflow-x-auto lg:pb-2">
          {items.map((item) => {
            const progress =
              item.coveredSeconds === undefined
                ? {}
                : {
                    progress: Math.min(1, item.coveredSeconds / item.durationSeconds),
                    progressLabel: t("item.progress", {
                      watched: formatFeedDuration(t, item.coveredSeconds),
                      total: formatFeedDuration(t, item.durationSeconds),
                    }),
                  };
            return (
              <li key={item.campaignId} className="lg:w-48 lg:shrink-0">
                <MediaCard
                  href={`/watch/${item.campaignId}`}
                  poster={item.posterUrl}
                  posterAlt=""
                  aspect="9:16"
                  title={item.title}
                  durationLabel={formatFeedDuration(t, item.durationSeconds)}
                  channel={
                    <span className="flex items-center gap-1.5 text-caption font-sans">
                      {/* 12.4.d/#9: same "Sponsored" text label as the main
                          feed card -- every row card is a funded campaign. */}
                      <Badge variant="outline" className="border-white/70 text-white">
                        {t("item.sponsored")}
                      </Badge>
                      <span>{item.merchantName}</span>
                    </span>
                  }
                  {...progress}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
