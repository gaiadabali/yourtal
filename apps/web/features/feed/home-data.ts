import "server-only";

import * as z from "zod";
import { campaignSchema } from "@yourtal/contracts/campaign";
import { feedResponseSchema, type FeedItem } from "@yourtal/contracts/feed";
import type { FacetCount } from "@yourtal/contracts/interest/tags";
import { continueWatchingResponseSchema } from "@yourtal/contracts/watch/continue-watching";
import type { AgeBand } from "@yourtal/contracts/identity/user-profile";
import { apiFetch } from "@/lib/api/api-fetch";
import { getMeProfile } from "@/features/me/me-data";
import { feedApiPath, type BrowseQuery } from "./browse-query";

export type BrowseItem = FeedItem;
export type Facet = FacetCount;

export interface ContinueItem {
  readonly campaignId: string;
  readonly title: string;
  readonly merchantName: string;
  readonly posterUrl: string;
  readonly durationSeconds: number;
  readonly coveredSeconds: number;
}

export interface HomeBrowseData {
  readonly items: readonly BrowseItem[];
  readonly categories: readonly Facet[];
  readonly tags: readonly Facet[];
  readonly continueWatching: readonly ContinueItem[];
  readonly savedIds: readonly string[];
  readonly ageBand: AgeBand;
}

const savesResponseSchema = z.object({ campaignIds: z.array(z.uuid()) });

function countBy(values: readonly string[]): Facet[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** The stand-in for a server without 13.12.a's filters yet: same rules, over one fetch. */
function narrow(all: readonly BrowseItem[], query: BrowseQuery) {
  const longForm = all.filter((item) => item.kind === "long_form");
  const inCategory = query.category
    ? longForm.filter((item) => item.contentCategory === query.category)
    : longForm;
  const tagged =
    query.tags.length === 0
      ? inCategory
      : inCategory.filter((item) => query.tags.some((tag) => item.tags.includes(tag)));
  const sorted = [...tagged];
  if (query.sort === "most_points") sorted.sort((a, b) => b.maxRewardPoints - a.maxRewardPoints);
  if (query.sort === "ending_soon")
    sorted.sort((a, b) => Number(b.endingSoon) - Number(a.endingSoon));
  return {
    items: sorted,
    categories: countBy(longForm.map((item) => item.contentCategory)),
    tags: countBy(inCategory.flatMap((item) => item.tags)),
  };
}

async function continueRows(): Promise<ContinueItem[]> {
  const sessions = await apiFetch("/api/watch/sessions", continueWatchingResponseSchema);
  if (!sessions.ok) return [];
  const rows = await Promise.all(
    sessions.data.sessions.map(async (session) => {
      const read = await apiFetch(`/api/campaigns/${session.campaignId}`, campaignSchema);
      if (!read.ok || read.data.kind !== "long_form") return null;
      return {
        campaignId: read.data.id,
        title: read.data.title,
        merchantName: read.data.merchantName,
        posterUrl: read.data.posterUrl,
        durationSeconds: read.data.durationSeconds,
        coveredSeconds: session.coveredSeconds,
      };
    }),
  );
  return rows.filter((row): row is ContinueItem => row !== null);
}

/** Everything the long-video Home needs. Only the feed read is required. */
export async function getHomeBrowse(
  query: BrowseQuery,
): Promise<{ ok: true; data: HomeBrowseData } | { ok: false }> {
  const isAll = query.category === null && query.tags.length === 0;
  const [feed, saves, profile, continueWatching] = await Promise.all([
    apiFetch(feedApiPath(query, "long_form"), feedResponseSchema),
    apiFetch("/api/me/saves", savesResponseSchema),
    getMeProfile(),
    isAll ? continueRows() : Promise.resolve([]),
  ]);
  if (!feed.ok) return { ok: false };

  const items = feed.data.items;
  // An older server returns items but no facets: narrow here instead.
  const serverFiltered = feed.data.facets.categories.length > 0 || items.length === 0;
  const narrowed = serverFiltered
    ? {
        items: items.filter((item) => item.kind === "long_form"),
        categories: feed.data.facets.categories,
        tags: feed.data.facets.tags,
      }
    : narrow(items, query);

  return {
    ok: true,
    data: {
      ...narrowed,
      continueWatching,
      savedIds: saves.ok ? saves.data.campaignIds : [],
      ageBand: profile.ok ? profile.data.profile.ageBand : "adult",
    },
  };
}
