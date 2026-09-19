import type { Campaign } from "@yourtal/contracts/campaign";
import {
  longMerchantNameCampaignFixture,
  mockCampaigns,
  zeroRewardCampaignFixture,
} from "@yourtal/contracts/campaign/mock";
import { REGION_CAMPAIGN_FIXTURES } from "@yourtal/contracts/region/mock";
import type { PublicLocale } from "./public-locale";

/**
 * Data access for the public campaign landing page (YT-0431,
 * `/[locale]/c/[campaignId]`). Deliberately its own module rather than a
 * reuse of `apps/web/features/campaign/campaign-data.ts` (out of bounds for
 * this ticket — see that file's header) and deliberately narrower than it:
 *
 * - **Fixed catalogue only, no `mock-source`/live seam.** Phase U ships no
 *   BFF (`docs/tasks/phase-u-ui.md` preamble), and the public surface has no
 *   ticket for a live merchant feed either, so there is nothing to switch
 *   between yet — adding `resolveDataSource` here would be a seam with one
 *   real side, ceremony for its own sake.
 * - **No hash-synthesised fallback.** `apps/web/features/player/get-watch-campaign.ts`
 *   deliberately synthesises a campaign for ANY id string so a hand-typed
 *   deep link never dead-ends behind a login wall. That is correct for a
 *   private player route; it is wrong here. A public, indexable page must
 *   correspond to a real catalogue entry — synthesising infinite plausible
 *   campaigns for arbitrary URLs is exactly the "scaled content abuse"
 *   docs/11-seo-aeo-geo.md §3 calls out, and it would mean `notFound()`
 *   never fires for a genuinely invalid id. `getPublicCampaign` below only
 *   ever returns a fixture that is actually in the mock catalogue.
 *
 * Only Server Components under `app/(public)/**` import this module — there
 * is no client leaf in this feature (see this ticket's report).
 *
 * **Locale-scoped (YT-0181).** `"id"` keeps the exact catalogue this ticket
 * always used; `"au"` reads `REGION_CAMPAIGN_FIXTURES.AU` from
 * `@yourtal/contracts/region/mock` — a real, independently-seeded Sydney
 * catalogue (see `public-locale.ts`'s header for why that used to not
 * exist). Every lookup takes the locale rather than searching both, so an
 * `/au/c/{id}` URL for an ID-only campaign 404s instead of silently serving
 * Jakarta content under an Australian URL.
 */
const PUBLIC_CAMPAIGN_CATALOGUE_ID: Campaign[] = [
  ...mockCampaigns,
  zeroRewardCampaignFixture,
  longMerchantNameCampaignFixture,
];

function catalogueFor(locale: PublicLocale): readonly Campaign[] {
  if (locale === "au") {
    const au = REGION_CAMPAIGN_FIXTURES.AU;
    return [...au.catalogue, au.longMerchantName];
  }
  return PUBLIC_CAMPAIGN_CATALOGUE_ID;
}

/**
 * Every campaign in the fixed public catalogue for this locale, any status.
 * Used by `generateStaticParams` so a campaign that stops being active after
 * being indexed keeps its URL — mirroring `docs/11-seo-aeo-geo.md` §2.3's
 * "expired offers 301 to the merchant page, never 404" principle: link rot
 * is worse than an honestly-labelled non-live page. The page itself
 * (`app/(public)/[locale]/c/[campaignId]/page.tsx`) shows a "not currently
 * live" notice instead of the sign-up call to action for a non-active
 * campaign — see `public-campaign-content.tsx`.
 */
export function listPublicCampaigns(locale: PublicLocale): Campaign[] {
  return [...catalogueFor(locale)];
}

/**
 * Only campaigns worth advertising as a live opportunity — the set the
 * merchant page and any future campaign catalogue link to. A paused or
 * ended campaign is a real page (see `listPublicCampaigns`) but not a live
 * call to action, so it is never the thing another public page points a
 * visitor at.
 */
export function listLivePublicCampaigns(locale: PublicLocale): Campaign[] {
  return catalogueFor(locale).filter((campaign) => campaign.status === "active");
}

/** A single campaign for the public landing page, or `undefined` if no such campaign exists in this locale's fixed catalogue. */
export function getPublicCampaign(campaignId: string, locale: PublicLocale): Campaign | undefined {
  return catalogueFor(locale).find((campaign) => campaign.id === campaignId);
}
