import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { deriveChapters } from "@/features/player/derive-chapters";
import { computeOpenViewCopy } from "@/features/open-view/open-view-copy";
import { OpenViewPlayer } from "@/features/open-view/open-view-player";
import { getPublicCampaign, listLivePublicCampaigns } from "@/features/public/public-campaign-data";
import {
  GENERATED_PUBLIC_LOCALES,
  publicLocaleConfig,
  publicUrl,
  requirePublicLocale,
} from "@/features/public/public-locale";
import { getPublicTranslator } from "@/features/public/public-i18n";
import { PublicBreadcrumbs } from "@/features/public/public-breadcrumbs";
import { slugify } from "@/features/public/public-slug";

/**
 * `/[locale]/c/[campaignId]/watch` — Open Viewing (YT-0432): anonymous full
 * playback of a campaign's video, no account, no reward UI. Only ever
 * generated for a campaign that is currently `active` —
 * `public-campaign-content.tsx` shows no call to action at all for a
 * non-live campaign (there is nothing to watch honestly), so this route
 * mirrors that and simply does not exist for one. `dynamicParams = false`
 * 404s a direct hit on a paused/ended/unlisted campaign's watch URL rather
 * than quietly reviving a page whose reward promise is no longer real.
 */
export function generateStaticParams() {
  return GENERATED_PUBLIC_LOCALES.flatMap((locale) =>
    listLivePublicCampaigns().map((campaign) => ({ locale, campaignId: campaign.id })),
  );
}

export const dynamicParams = false;

interface OpenViewWatchPageProps {
  params: Promise<{ locale: string; campaignId: string }>;
}

function requireLiveCampaign(campaignId: string) {
  const campaign = getPublicCampaign(campaignId);
  if (!campaign || campaign.status !== "active") {
    notFound();
  }
  return campaign;
}

export async function generateMetadata({ params }: OpenViewWatchPageProps): Promise<Metadata> {
  const { locale: rawLocale, campaignId } = await params;
  const locale = requirePublicLocale(rawLocale);
  const campaign = requireLiveCampaign(campaignId);
  const url = publicUrl(locale, `/c/${campaign.id}/watch`);

  return {
    title: `${campaign.title} — ${campaign.merchantName} | YourTal`,
    description: campaign.synopsis,
    alternates: { canonical: url },
    // Deliberately no custom `opengraph-image.tsx` for this action page:
    // the parent `/c/[campaignId]` page's own OG card already carries the
    // one honest reward/duration claim docs/11-seo-aeo-geo.md section 5
    // cares about, and this route is reached by clicking through that
    // page, never shared as a link on its own — duplicating the card here
    // would be ceremony with no reader benefit.
  };
}

export default async function OpenViewWatchPage({ params }: OpenViewWatchPageProps) {
  const { locale: rawLocale, campaignId } = await params;
  const locale = requirePublicLocale(rawLocale);
  const campaign = requireLiveCampaign(campaignId);

  const config = publicLocaleConfig(locale);
  const t = getPublicTranslator(config.intlLocale);
  const chapters = deriveChapters(campaign);
  const copy = computeOpenViewCopy(campaign, config);
  const merchantSlug = slugify(campaign.merchantName);

  return (
    <>
      <PublicBreadcrumbs
        items={[
          { name: t("breadcrumb.home"), url: publicUrl(locale, "/") },
          { name: campaign.merchantName, url: publicUrl(locale, `/m/${merchantSlug}`) },
          { name: campaign.title, url: publicUrl(locale, `/c/${campaign.id}`) },
          { name: copy.breadcrumbLabel, url: publicUrl(locale, `/c/${campaign.id}/watch`) },
        ]}
      />
      <OpenViewPlayer campaign={campaign} chapters={chapters} copy={copy} />
    </>
  );
}
