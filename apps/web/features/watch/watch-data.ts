import "server-only";

import type { FeedItem } from "@yourtal/contracts/feed";
import { feedResponseSchema } from "@yourtal/contracts/feed";
import { apiFetch, type ApiResult } from "@/lib/api/api-fetch";

/**
 * The Watch tab's data-access seam (11.7.d) — a YouTube-style grid of the
 * long-form campaigns, from the same `GET /api/feed` the Home For You feed
 * reads (`features/feed/feed-data.ts`, not editable here — see this
 * feature's own README-shaped note below).
 *
 * `?surface=watch` is passed for the API to key its own ranking/pacing
 * bookkeeping on, but `getFeed` (`apps/api/src/modules/feed`) does not yet
 * filter its candidates by surface — home and watch return the same
 * campaign set today. This module filters to `kind === "long_form"`
 * itself, client of the contract rather than assuming the surface param
 * already narrows anything: a quick campaign (F15, no questions, earns
 * inside the feed) has no honest "watch page" to link to here.
 */
export interface WatchGridItem {
  readonly campaignId: string;
  readonly title: string;
  readonly merchantName: string;
  readonly posterUrl: string;
  readonly durationSeconds: number;
  readonly kind: FeedItem["kind"];
  readonly questionCount: number;
  readonly rewardPoints: number;
  readonly maxRewardPoints: number;
  readonly estimatedDataMb: number;
}

function toGridItem(item: FeedItem): WatchGridItem {
  return {
    campaignId: item.campaignId,
    title: item.title,
    merchantName: item.merchantName,
    posterUrl: item.posterUrl,
    durationSeconds: item.durationSeconds,
    kind: item.kind,
    questionCount: item.questionCount,
    rewardPoints: item.rewardPoints,
    maxRewardPoints: item.maxRewardPoints,
    estimatedDataMb: item.estimatedDataMb,
  };
}

/** Long-form campaigns for the Watch grid, in the feed's own ranked order. */
export async function listWatchItems(): Promise<ApiResult<readonly WatchGridItem[]>> {
  const result = await apiFetch("/api/feed?surface=watch", feedResponseSchema);
  if (!result.ok) return result;
  return {
    ok: true,
    data: result.data.items.filter((item) => item.kind === "long_form").map(toGridItem),
  };
}
