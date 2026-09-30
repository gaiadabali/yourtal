import type { FacetCount } from "@yourtal/contracts/interest/tags";
import type { FeedFacets, FeedSort } from "@yourtal/contracts/feed";
import type { FeedItem } from "@yourtal/contracts/feed";
import type { CampaignKind } from "@yourtal/contracts/campaign";
import type { ContentCategory } from "@yourtal/jurisdiction/content-category";

/**
 * 13.12.a: the browse half of `GET /api/feed`, applied to the already-walled,
 * already-ranked items. Pure, so its filters, sorts and facets are unit tested
 * without a database; the walls themselves stay in `ranking.ts`'s filter.
 */
export interface FeedBrowseFilter {
  readonly kind?: CampaignKind | undefined;
  readonly category?: ContentCategory | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly sort: FeedSort;
}

/** What a sort needs beyond the card itself. */
export interface FeedSortKeys {
  readonly publishedAt: (campaignId: string) => number;
  readonly endsAt: (campaignId: string) => number;
}

const matchesKind = (item: FeedItem, filter: FeedBrowseFilter) =>
  filter.kind === undefined || item.kind === filter.kind;
const matchesCategory = (item: FeedItem, filter: FeedBrowseFilter) =>
  filter.category === undefined || item.contentCategory === filter.category;
const matchesTags = (item: FeedItem, filter: FeedBrowseFilter) =>
  filter.tags === undefined ||
  filter.tags.length === 0 ||
  item.tags.some((tag) => filter.tags?.includes(tag) === true);

function countBy(values: readonly string[]): FacetCount[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** Each facet ignores its own filter and honours the others; `kind` always applies. */
export function feedFacets(items: readonly FeedItem[], filter: FeedBrowseFilter): FeedFacets {
  const ofKind = items.filter((item) => matchesKind(item, filter));
  return {
    categories: countBy(
      ofKind.filter((item) => matchesTags(item, filter)).map((item) => item.contentCategory),
    ),
    tags: countBy(
      ofKind.filter((item) => matchesCategory(item, filter)).flatMap((item) => item.tags),
    ),
  };
}

export function applyFeedBrowse(
  items: readonly FeedItem[],
  filter: FeedBrowseFilter,
  keys: FeedSortKeys,
): FeedItem[] {
  const matching = items.filter(
    (item) =>
      matchesKind(item, filter) && matchesCategory(item, filter) && matchesTags(item, filter),
  );
  // Array.prototype.sort is stable, so ties keep the ranked order.
  switch (filter.sort) {
    case "for_you":
      return matching;
    case "newest":
      return [...matching].sort(
        (a, b) => keys.publishedAt(b.campaignId) - keys.publishedAt(a.campaignId),
      );
    case "most_points":
      return [...matching].sort((a, b) => b.maxRewardPoints - a.maxRewardPoints);
    case "ending_soon":
      return [...matching].sort((a, b) => keys.endsAt(a.campaignId) - keys.endsAt(b.campaignId));
  }
}
