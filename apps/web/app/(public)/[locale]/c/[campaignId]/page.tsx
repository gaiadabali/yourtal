import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getPublicCampaignForLocale,
  getPublicCampaignTermsFromApi,
  listPublicCampaigns,
} from "@/features/public/public-campaign-data";
import {
  GENERATED_PUBLIC_LOCALES,
  publicLocaleConfig,
  publicUrl,
  requirePublicLocale,
} from "@/features/public/public-locale";
import { getPublicTranslator } from "@/features/public/public-i18n";
import { PublicBreadcrumbs } from "@/features/public/public-breadcrumbs";
import { PublicCampaignContent } from "@/features/public/public-campaign-content";
import { publicTwitterCard } from "@/features/public/public-twitter-card";
import { slugify } from "@/features/public/public-slug";
import { buildCampaignVideoObjectJsonLd } from "@/features/public/public-jsonld";
import { PublicJsonLdScript } from "@/features/public/public-json-ld-script";

/**
 * `/[locale]/c/[campaignId]` — the public campaign landing page (YT-0431,
 * `docs/11-seo-aeo-geo.md` §1's `/id/c/[campaign]`). `generateStaticParams`
 * pre-renders every locale × every campaign in the fixed mock catalogue at
 * build time; nothing in this file or anything it imports calls
 * `cookies()`/`headers()`, so those come out static (`○`).
 *
 * **11.2.a: `dynamicParams = true`.** A real, seeded campaign id (from the
 * live anonymous feed, 11.1.b) is not in that mock catalogue and was never
 * in `generateStaticParams` — with `dynamicParams` still `false` it would
 * 404 outright. `getPublicCampaignForLocale` tries the mock catalogue
 * first, then falls back to `GET /api/campaigns/:campaignId` (Open
 * Viewing's anonymous read); Next renders that first hit on demand and
 * caches it as ISR (`revalidate` below), same as a build-time page from
 * here on. An id that matches neither still 404s.
 */
export function generateStaticParams() {
  return GENERATED_PUBLIC_LOCALES.flatMap((locale) =>
    listPublicCampaigns(locale).map((campaign) => ({ locale, campaignId: campaign.id })),
  );
}

export const dynamicParams = true;
export const revalidate = 60;

interface PublicCampaignPageProps {
  params: Promise<{ locale: string; campaignId: string }>;
}

export async function generateMetadata({ params }: PublicCampaignPageProps): Promise<Metadata> {
  const { locale: rawLocale, campaignId } = await params;
  const locale = requirePublicLocale(rawLocale);
  const campaign = await getPublicCampaignForLocale(campaignId, locale);
  if (!campaign) {
    notFound();
  }
  const url = publicUrl(locale, `/c/${campaign.id}`);
  const imageUrl = publicUrl(locale, `/c/${campaign.id}/opengraph-image`);

  return {
    title: `${campaign.title} — ${campaign.merchantName} | YourTal`,
    description: campaign.synopsis,
    alternates: { canonical: url },
    openGraph: { title: campaign.title, description: campaign.synopsis, url, type: "website" },
    twitter: publicTwitterCard({ title: campaign.title, description: campaign.synopsis, imageUrl }),
  };
}

export default async function PublicCampaignPage({ params }: PublicCampaignPageProps) {
  const { locale: rawLocale, campaignId } = await params;
  const locale = requirePublicLocale(rawLocale);
  const campaign = await getPublicCampaignForLocale(campaignId, locale);
  if (!campaign) {
    notFound();
  }
  // Real terms only exist for a seeded (API) campaign, never the fixed mock
  // catalogue — `undefined` there is expected, not an error (11.5.a).
  const terms = await getPublicCampaignTermsFromApi(campaignId);

  const config = publicLocaleConfig(locale);
  const t = getPublicTranslator(config.intlLocale);
  const merchantSlug = slugify(campaign.merchantName);
  const url = publicUrl(locale, `/c/${campaign.id}`);

  return (
    <>
      <PublicJsonLdScript data={buildCampaignVideoObjectJsonLd({ campaign, url })} />
      <PublicBreadcrumbs
        navAriaLabel={t("breadcrumbNav.ariaLabel")}
        items={[
          { name: t("breadcrumb.home"), url: publicUrl(locale, "/") },
          { name: campaign.merchantName, url: publicUrl(locale, `/m/${merchantSlug}`) },
          { name: campaign.title, url: publicUrl(locale, `/c/${campaign.id}`) },
        ]}
      />
      <PublicCampaignContent
        campaign={campaign}
        accuracyBonusPoints={terms?.accuracyBonusPoints ?? 0}
        locale={config}
        merchantHref={`/${locale}/m/${merchantSlug}`}
        watchHref={`/${locale}/c/${campaign.id}/watch`}
      />
    </>
  );
}
