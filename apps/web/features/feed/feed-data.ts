import "server-only";

import * as z from "zod";
import type { FeedItem } from "@yourtal/contracts/feed";
import { feedResponseSchema } from "@yourtal/contracts/feed";
import type { Region } from "@yourtal/contracts/region";
import type { AgeBand } from "@yourtal/contracts/identity/user-profile";
import { apiFetch } from "@/lib/api/api-fetch";
import { readSessionToken } from "@/lib/api/session-cookies";
import { getAutoplaySetting, getMeProfile } from "@/features/me/me-data";
import { earnedToday } from "@/features/wallet/wallet-data";
import type { AutoplaySetting } from "@yourtal/contracts/me/autoplay-setting";

export interface ShortsFeedData {
  /**
   * Nobody is signed in (F8, F79): these are the Open Viewing Shorts, which play for anyone and earn for no one.
   * The feed shows a sign-up prompt where the earn control would be, and no save, hide or points.
   */
  readonly signedOut: boolean;
  readonly items: readonly FeedItem[];
  readonly savedIds: readonly string[];
  readonly earnedToday: number;
  readonly autoplay: AutoplaySetting;
  /** 12.2.b: the teen watch-time reminder. `"adult"` when the profile read fails. */
  readonly ageBand: AgeBand;
}

const savesResponseSchema = z.object({ campaignIds: z.array(z.uuid()) });

/**
 * What a visitor sees: the anonymous feed, which the API limits to Open Viewing campaigns rated all-ages, in the
 * region the visitor's own cookie names. It answers 400 `region_required` without one, so the region is always sent.
 */
async function getVisitorShortsFeed(
  region: Region,
): Promise<{ ok: true; data: ShortsFeedData } | { ok: false }> {
  const feed = await apiFetch(
    `/api/feed?surface=home&kind=quick&region=${region}`,
    feedResponseSchema,
  );
  if (!feed.ok) return { ok: false };
  return {
    ok: true,
    data: {
      signedOut: true,
      items: feed.data.items.filter((item) => item.kind === "quick"),
      savedIds: [],
      earnedToday: 0,
      autoplay: "always",
      ageBand: "adult",
    },
  };
}

/**
 * Everything Shorts needs (13.14.a), in parallel. Only the feed itself is required. Signed out, or with a session
 * the API no longer accepts, it is the visitor's feed instead (never the error state: 5.6.c).
 */
export async function getShortsFeed(
  region: Region,
): Promise<{ ok: true; data: ShortsFeedData } | { ok: false }> {
  if ((await readSessionToken()) === null) return getVisitorShortsFeed(region);
  const [feed, saves, autoplay, today, profile] = await Promise.all([
    apiFetch("/api/feed?surface=home&kind=quick", feedResponseSchema),
    apiFetch("/api/me/saves", savesResponseSchema),
    getAutoplaySetting(),
    earnedToday(region),
    getMeProfile(),
  ]);
  if (!feed.ok) {
    const expired = feed.error.kind === "http" && feed.error.status === 401;
    return expired ? getVisitorShortsFeed(region) : { ok: false };
  }
  return {
    ok: true,
    data: {
      signedOut: false,
      // Filtered here too until 13.12.a's `kind` lands on the API.
      items: feed.data.items.filter((item) => item.kind === "quick"),
      savedIds: saves.ok ? saves.data.campaignIds : [],
      earnedToday: today,
      autoplay: autoplay.ok ? autoplay.data.autoplay : "always",
      ageBand: profile.ok ? profile.data.profile.ageBand : "adult",
    },
  };
}
