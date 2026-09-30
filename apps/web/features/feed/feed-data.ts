import "server-only";

import { z } from "zod";
import type { FeedItem } from "@yourtal/contracts/feed";
import { feedResponseSchema } from "@yourtal/contracts/feed";
import type { Region } from "@yourtal/contracts/region";
import type { AgeBand } from "@yourtal/contracts/identity/user-profile";
import { apiFetch } from "@/lib/api/api-fetch";
import { getAutoplaySetting, getMeProfile } from "@/features/me/me-data";
import { earnedToday } from "@/features/wallet/wallet-data";
import type { AutoplaySetting } from "@yourtal/contracts/me/autoplay-setting";

export interface ShortsFeedData {
  readonly items: readonly FeedItem[];
  readonly savedIds: readonly string[];
  readonly earnedToday: number;
  readonly autoplay: AutoplaySetting;
  /** 12.2.b: the teen watch-time reminder. `"adult"` when the profile read fails. */
  readonly ageBand: AgeBand;
}

const savesResponseSchema = z.object({ campaignIds: z.array(z.uuid()) });

/** Everything Shorts needs (13.14.a), in parallel. Only the feed itself is required. */
export async function getShortsFeed(
  region: Region,
): Promise<{ ok: true; data: ShortsFeedData } | { ok: false }> {
  const [feed, saves, autoplay, today, profile] = await Promise.all([
    apiFetch("/api/feed?surface=home&kind=quick", feedResponseSchema),
    apiFetch("/api/me/saves", savesResponseSchema),
    getAutoplaySetting(),
    earnedToday(region),
    getMeProfile(),
  ]);
  if (!feed.ok) return { ok: false };
  return {
    ok: true,
    data: {
      // Filtered here too until 13.12.a's `kind` lands on the API.
      items: feed.data.items.filter((item) => item.kind === "quick"),
      savedIds: saves.ok ? saves.data.campaignIds : [],
      earnedToday: today,
      autoplay: autoplay.ok ? autoplay.data.autoplay : "always",
      ageBand: profile.ok ? profile.data.profile.ageBand : "adult",
    },
  };
}
