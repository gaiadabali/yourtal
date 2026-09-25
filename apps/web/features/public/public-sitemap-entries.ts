import type { MetadataRoute } from "next";
import { listPublicCampaigns } from "./public-campaign-data";
import { listPublicListings } from "./public-listing-data";
import { listPublicMerchants } from "./public-merchant";
import { GENERATED_PUBLIC_LOCALES, publicLanguageAlternates, publicUrl } from "./public-locale";
import { slugify } from "./public-slug";
import { PUBLIC_INFO_SLUGS } from "./public-info-pages";

/**
 * Every indexable public URL (YT-0180), for `app/sitemap.ts`. Built from the
 * same locale-scoped catalogue calls each route's own `generateStaticParams`
 * uses (`public-campaign-data.ts`, `public-listing-data.ts`,
 * `public-merchant.ts`) — never a hand-maintained list, so a URL here can
 * never drift from what the router actually serves in either direction: it
 * cannot list a page that isn't generated, and a real catalogue entry
 * cannot go missing from it.
 *
 * **Deliberately excludes `/[locale]/c/[campaignId]/watch`** (Open
 * Viewing). That route's own `generateMetadata` already gives the reason
 * this file reuses: it carries no OG card of its own because it is an
 * action reached by clicking through the campaign page, never a page a
 * visitor lands on directly or a link shared on its own — the same
 * property that makes it not worth a distinct sitemap entry either. The
 * campaign page it hangs off is already listed.
 *
 * **No fabricated `lastModified`.** A campaign's genuine `publishedAt` is
 * used where one exists; listings and merchants carry no comparable
 * timestamp in this contract (`expiresAt` is a future date, not a past
 * edit), so their entries omit the field rather than claim a freshness this
 * data cannot back up. Same reasoning for `changeFrequency`/`priority`:
 * both are optional hints with no genuine signal behind them here, so
 * neither is emitted.
 */
export function publicSitemapEntries(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];

  for (const locale of GENERATED_PUBLIC_LOCALES) {
    entries.push(
      { url: publicUrl(locale, "/"), alternates: { languages: publicLanguageAlternates("/") } },
      {
        url: publicUrl(locale, "/rewards"),
        alternates: { languages: publicLanguageAlternates("/rewards") },
      },
    );

    for (const slug of PUBLIC_INFO_SLUGS) {
      entries.push({
        url: publicUrl(locale, `/${slug}`),
        alternates: { languages: publicLanguageAlternates(`/${slug}`) },
      });
    }

    for (const campaign of listPublicCampaigns(locale)) {
      entries.push({
        url: publicUrl(locale, `/c/${campaign.id}`),
        lastModified: campaign.publishedAt,
      });
    }

    for (const listing of listPublicListings(locale)) {
      const merchantSlug = slugify(listing.merchantName);
      entries.push({ url: publicUrl(locale, `/rewards/${merchantSlug}/${listing.id}`) });
    }

    for (const merchant of listPublicMerchants(locale)) {
      entries.push({ url: publicUrl(locale, `/m/${merchant.slug}`) });
    }
  }

  return entries;
}
