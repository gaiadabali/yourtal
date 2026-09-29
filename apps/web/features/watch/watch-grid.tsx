import {
  formatFeedDuration,
  feedTermsLine,
  type FeedLocale,
  type FeedTermsTranslator,
} from "@/features/feed/feed-terms";
import type { WatchGridItem } from "./watch-data";
import { WatchCard } from "./watch-card";

export interface WatchGridProps {
  items: readonly WatchGridItem[];
  /** The `feed` namespace translator (`terms.*` keys) — shared with Home so the two never say duration two different ways. */
  t: FeedTermsTranslator;
  locale: FeedLocale;
}

/**
 * The Watch tab's grid (11.7.d) — a YouTube-style layout of long-form
 * campaigns, wider than the Store's dense catalogue grid since each tile
 * carries a 16:9 poster plus a full terms line. Server Component: nothing
 * here is interactive beyond the plain `<a>` inside each `WatchCard`.
 */
export function WatchGrid({ items, t, locale }: WatchGridProps) {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((item) => (
        <li key={item.campaignId}>
          <WatchCard
            item={item}
            durationLabel={formatFeedDuration(t, item.durationSeconds)}
            termsLine={feedTermsLine(t, locale, item)}
          />
        </li>
      ))}
    </ul>
  );
}
