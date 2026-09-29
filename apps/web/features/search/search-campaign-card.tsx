import { MediaCard } from "@yourtal/ui/media-card";
import type { FeedItem } from "@yourtal/contracts/feed";
import { feedTermsLine } from "@/features/feed/feed-terms";
import { getFeedTermsTranslator, type FeedLocale } from "./search-feed-terms";

export interface SearchCampaignCardProps {
  item: FeedItem;
  locale: FeedLocale;
}

/** One campaign result (11.7.b) — same honest-terms line convention as the Watch grid and Home feed. */
export function SearchCampaignCard({ item, locale }: SearchCampaignCardProps) {
  const t = getFeedTermsTranslator(locale);
  return (
    <MediaCard
      href={`/campaign/${item.campaignId}`}
      poster={item.posterUrl}
      posterAlt=""
      aspect="16:9"
      title={item.title}
      channel={<span className="text-caption font-sans">{item.merchantName}</span>}
      reward={
        <span className="text-caption font-sans">{feedTermsLine(t, locale, item)}</span>
      }
    />
  );
}
