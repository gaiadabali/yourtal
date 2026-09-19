import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicCampaign, listPublicCampaigns } from "@/features/public/public-campaign-data";
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

/**
 * `/[locale]/c/[campaignId]` — the public campaign landing page (YT-0431,
 * `docs/11-seo-aeo-geo.md` §1's `/id/c/[campaign]`). Server-rendered at
 * build time only: `generateStaticParams` enumerates every locale × every
 * campaign in the fixed mock catalogue, `dynamicParams = false` 404s
 * anything else at the router, and nothing in this file or anything it
 * imports calls `cookies()`/`headers()` — see this ticket's report for the
 * build output confirming this route comes out static (`○`).
 */
export function generateStaticParams() {
  return GENERATED_PUBLIC_LOCALES.flatMap((locale) =>
    listPublicCampaigns(locale).map((campaign) => ({ locale, campaignId: campaign.id })),
  );
}

export const dynamicParams = false;

interface PublicCampaignPageProps {
  params: Promise<{ locale: string; campaignId: string }>;
}

export async function generateMetadata({ params }: PublicCampaignPageProps): Promise<Metadata> {
  const { locale: rawLocale, campaignId } = await params;
  const locale = requirePublicLocale(rawLocale);
  const campaign = getPublicCampaign(campaignId, locale);
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
  const campaign = getPublicCampaign(campaignId, locale);
  if (!campaign) {
    notFound();
  }

  const config = publicLocaleConfig(locale);
  const t = getPublicTranslator(config.intlLocale);
  const merchantSlug = slugify(campaign.merchantName);

  return (
    <>
      <PublicBreadcrumbs
        items={[
          { name: t("breadcrumb.home"), url: publicUrl(locale, "/") },
          { name: campaign.merchantName, url: publicUrl(locale, `/m/${merchantSlug}`) },
          { name: campaign.title, url: publicUrl(locale, `/c/${campaign.id}`) },
        ]}
      />
      <PublicCampaignContent
        campaign={campaign}
        locale={config}
        merchantHref={`/${locale}/m/${merchantSlug}`}
        watchHref={`/${locale}/c/${campaign.id}/watch`}
      />
    </>
  );
}
