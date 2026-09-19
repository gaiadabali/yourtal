import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { getPublicCampaign, listPublicCampaigns } from "@/features/public/public-campaign-data";
import {
  GENERATED_PUBLIC_LOCALES,
  publicLocaleConfig,
  requirePublicLocale,
} from "@/features/public/public-locale";
import { getPublicTranslator } from "@/features/public/public-i18n";
import { computeCampaignRewardFacts } from "@/features/public/public-reward-facts";
import {
  PUBLIC_OG_IMAGE_CONTENT_TYPE,
  PUBLIC_OG_IMAGE_SIZE,
  PublicOgCard,
} from "@/features/public/public-og-card";

export const size = PUBLIC_OG_IMAGE_SIZE;
export const contentType = PUBLIC_OG_IMAGE_CONTENT_TYPE;

export function generateStaticParams() {
  return GENERATED_PUBLIC_LOCALES.flatMap((locale) =>
    listPublicCampaigns().map((campaign) => ({ locale, campaignId: campaign.id })),
  );
}

export const dynamicParams = false;

interface CampaignOgImageProps {
  params: Promise<{ locale: string; campaignId: string }>;
}

/**
 * The campaign page's generated share card (YT-0431). No remote asset
 * fetch, no custom font — see `public-og-card.tsx`'s header. `rewardLine`
 * is built from the same `computeCampaignRewardFacts` the page body uses,
 * so the card a link preview shows never states a different reward or
 * duration than the page it links to.
 */
export default async function CampaignOgImage({ params }: CampaignOgImageProps) {
  const { locale: rawLocale, campaignId } = await params;
  const locale = requirePublicLocale(rawLocale);
  const campaign = getPublicCampaign(campaignId);
  if (!campaign) {
    notFound();
  }

  const config = publicLocaleConfig(locale);
  const t = getPublicTranslator(config.intlLocale);
  const facts = computeCampaignRewardFacts(campaign, config);

  return new ImageResponse(
    <PublicOgCard
      eyebrow={t("campaign.eyebrow")}
      title={campaign.title}
      merchantName={campaign.merchantName}
      rewardLine={facts.headline}
    />,
    { ...PUBLIC_OG_IMAGE_SIZE },
  );
}
