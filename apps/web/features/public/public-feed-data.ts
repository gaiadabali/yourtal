import "server-only";

import { feedResponseSchema } from "@yourtal/contracts/feed";
import type { FeedItem } from "@yourtal/contracts/feed";
import { publicApiFetch } from "@/lib/api/public-api-fetch";
import type { PublicLocale } from "./public-locale";
import { publicLocaleRegion } from "./public-locale";

/** How long a stale copy of the anonymous feed may serve before the next request revalidates it (11.2.a). */
const FEED_REVALIDATE_SECONDS = 60;

/**
 * The logged-out "For You" feed (11.1.b): every Open Viewing, all-ages
 * campaign the anonymous role can see (`campaign_view.yaml`'s
 * `open-viewing-is-opt-in-and-funded` rule; `getFeed`'s own
 * `ctx.anonymous && !campaign.openViewing` filter). Region comes from the
 * `[locale]` route segment, never a cookie — same rule every other public
 * data function in this feature follows (`public-locale.ts`'s header).
 *
 * Never throws and never fails the build: an unreachable API at build/
 * revalidate time returns an empty feed rather than a broken page — the
 * caller renders `public-feed-empty-state.tsx` for both "genuinely nothing
 * live yet" and "the API didn't answer," which is the honest thing to show
 * either way (a visitor cannot tell those apart and should not have to).
 */
export async function getPublicFeed(locale: PublicLocale): Promise<readonly FeedItem[]> {
  const result = await publicApiFetch("/api/feed", feedResponseSchema, {
    searchParams: { region: publicLocaleRegion(locale), surface: "home" },
    revalidate: FEED_REVALIDATE_SECONDS,
  });
  if (!result.ok) {
    return [];
  }
  return result.data.items;
}
