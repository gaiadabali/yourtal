import { MediaCard } from "@yourtal/ui/media-card";
import type { WatchGridItem } from "./watch-data";

export interface WatchCardProps {
  item: WatchGridItem;
  /** e.g. "18 min" — corner badge. */
  durationLabel: string;
  /** The honest terms line (feedTermsLine), shown on the card before any tap — Phase 3's F12 rule. */
  termsLine: string;
}

/**
 * One tile on the Watch grid (11.7.d) — a 16:9 `MediaCard` (unlike Home's
 * 9:16 vertical teasers, `feed-row.tsx`), since this is the YouTube-style
 * long-form destination, not the swipe feed. Links straight to
 * `/watch/[campaignId]` (agent D's rebuild of that page owns everything
 * past this point).
 */
export function WatchCard({ item, durationLabel, termsLine }: WatchCardProps) {
  return (
    <MediaCard
      href={`/watch/${item.campaignId}`}
      poster={item.posterUrl}
      posterAlt=""
      aspect="16:9"
      title={item.title}
      durationLabel={durationLabel}
      channel={<span className="text-caption font-sans">{item.merchantName}</span>}
      reward={<span className="text-caption font-sans">{termsLine}</span>}
    />
  );
}
