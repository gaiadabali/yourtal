import type { FeedItem } from "@yourtal/contracts/feed";
import { describeFeedItemTerms } from "./public-feed-terms";
import type { PublicLocale, PublicLocaleConfig } from "./public-locale";

/**
 * The plain, serialisable shape `PublicFeedTeaser` (a Client Component
 * leaf) actually renders — every string pre-translated and every number
 * pre-formatted here, on the server, so the client bundle needs no i18n
 * machinery of its own (same "push translation to the server side" rule
 * `public-cta-link.tsx`'s doc comment already follows for this route
 * group).
 */
export interface PublicFeedTeaserViewItem {
  id: string;
  href: string;
  merchantName: string;
  title: string;
  poster: string;
  teaser: string;
  /** "18 min · 3 questions · up to 112 pts · ~120 MB · finish to earn" (F12). */
  termsLabel: string;
}

/** Maps the API's `FeedItem[]` (11.2.a) to teaser view items for `/[locale]` (11.1.b). */
export function toPublicFeedTeaserItems(
  items: readonly FeedItem[],
  locale: PublicLocale,
  config: PublicLocaleConfig,
): PublicFeedTeaserViewItem[] {
  return items.map((item) => ({
    id: item.campaignId,
    href: `/${locale}/c/${item.campaignId}`,
    merchantName: item.merchantName,
    title: item.title,
    poster: item.posterUrl,
    teaser: item.teaserUrl,
    termsLabel: describeFeedItemTerms(item, config),
  }));
}
