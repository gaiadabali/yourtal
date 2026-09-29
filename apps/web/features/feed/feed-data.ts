import "server-only";

import { z } from "zod";
import { campaignSchema } from "@yourtal/contracts/campaign";
import type { FeedItem } from "@yourtal/contracts/feed";
import { feedResponseSchema } from "@yourtal/contracts/feed";
import type { Region } from "@yourtal/contracts/region";
import { continueWatchingResponseSchema } from "@yourtal/contracts/watch/continue-watching";
import type { WalletPending } from "@yourtal/contracts/wallet/wallet";
import type { AgeBand } from "@yourtal/contracts/identity/user-profile";
import { apiFetch } from "@/lib/api/api-fetch";
import { getAutoplaySetting, getMeProfile, listFollows } from "@/features/me/me-data";
import { earnedToday, getWalletBalance } from "@/features/wallet/wallet-data";
import type { AutoplaySetting } from "@yourtal/contracts/me/autoplay-setting";

/** A campaign shown in a Home row: enough for a poster card, from the feed or the campaign read. */
export interface FeedRowItem {
  readonly campaignId: string;
  readonly title: string;
  readonly merchantName: string;
  readonly posterUrl: string;
  readonly durationSeconds: number;
  /** Only for Continue watching. */
  readonly coveredSeconds?: number;
}

export interface HomeFeedData {
  readonly items: readonly FeedItem[];
  readonly savedIds: readonly string[];
  readonly rows: {
    readonly continue: readonly FeedRowItem[];
    readonly saved: readonly FeedRowItem[];
    readonly following: readonly FeedRowItem[];
    readonly endingSoon: readonly FeedRowItem[];
  };
  readonly streakDays: number;
  readonly pending: readonly WalletPending[];
  readonly earnedToday: number;
  readonly autoplay: AutoplaySetting;
  /**
   * 12.2.b: no streak counter for a teen, anywhere -- `HomeFeed` reads this
   * to decide whether `StreakStrip` renders at all. Defaults to `"adult"`
   * when the profile read itself fails, which only ever WIDENS what
   * already rendered before this field existed, never narrows it.
   */
  readonly ageBand: AgeBand;
}

const savesResponseSchema = z.object({ campaignIds: z.array(z.uuid()) });
const streakResponseSchema = z.object({ currentLength: z.number().int().min(0) });

function fromFeedItem(item: FeedItem): FeedRowItem {
  return {
    campaignId: item.campaignId,
    title: item.title,
    merchantName: item.merchantName,
    posterUrl: item.posterUrl,
    durationSeconds: item.durationSeconds,
  };
}

/** Rows can name campaigns the feed left out (already earned, say): read those one by one. */
async function rowItemsFor(
  ids: readonly string[],
  byId: ReadonlyMap<string, FeedItem>,
): Promise<FeedRowItem[]> {
  const rows = await Promise.all(
    ids.map(async (id) => {
      const fromFeed = byId.get(id);
      if (fromFeed) return fromFeedItem(fromFeed);
      const read = await apiFetch(`/api/campaigns/${id}`, campaignSchema);
      if (!read.ok) return null;
      const campaign = read.data;
      return {
        campaignId: campaign.id,
        title: campaign.title,
        merchantName: campaign.merchantName,
        posterUrl: campaign.posterUrl,
        durationSeconds: campaign.durationSeconds,
      };
    }),
  );
  return rows.filter((row): row is FeedRowItem => row !== null);
}

/** Everything the signed-in Home needs, in parallel. Only the feed itself is required. */
export async function getHomeFeed(
  region: Region,
): Promise<{ ok: true; data: HomeFeedData } | { ok: false }> {
  const [feed, saves, follows, sessions, streak, wallet, autoplay, today, profile] =
    await Promise.all([
      apiFetch("/api/feed?surface=home", feedResponseSchema),
      apiFetch("/api/me/saves", savesResponseSchema),
      listFollows(),
      apiFetch("/api/watch/sessions", continueWatchingResponseSchema),
      apiFetch("/api/me/streak", streakResponseSchema),
      getWalletBalance(),
      getAutoplaySetting(),
      earnedToday(region),
      getMeProfile(),
    ]);
  if (!feed.ok) return { ok: false };

  const items = feed.data.items;
  const byId = new Map(items.map((item) => [item.campaignId, item]));
  const savedIds = saves.ok ? saves.data.campaignIds : [];
  const followedIds = new Set(follows.ok ? follows.data.follows.map((f) => f.businessId) : []);
  const active = sessions.ok ? sessions.data.sessions : [];

  const [continueRows, savedRows] = await Promise.all([
    rowItemsFor(
      active.map((s) => s.campaignId),
      byId,
    ),
    rowItemsFor(savedIds, byId),
  ]);
  const coveredById = new Map(active.map((s) => [s.campaignId, s.coveredSeconds]));

  return {
    ok: true,
    data: {
      items,
      savedIds,
      rows: {
        continue: continueRows.map((row) => ({
          ...row,
          coveredSeconds: coveredById.get(row.campaignId) ?? 0,
        })),
        saved: savedRows,
        following: items.filter((item) => followedIds.has(item.businessId)).map(fromFeedItem),
        endingSoon: items.filter((item) => item.endingSoon).map(fromFeedItem),
      },
      streakDays: streak.ok ? streak.data.currentLength : 0,
      pending: wallet.ok ? wallet.data.pending : [],
      earnedToday: today,
      autoplay: autoplay.ok ? autoplay.data.autoplay : "always",
      ageBand: profile.ok ? profile.data.profile.ageBand : "adult",
    },
  };
}
