import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { getPublicListing, listPublicListings } from "@/features/public/public-listing-data";
import {
  GENERATED_PUBLIC_LOCALES,
  publicLocaleConfig,
  requirePublicLocale,
} from "@/features/public/public-locale";
import { getPublicTranslator } from "@/features/public/public-i18n";
import { computeOfferRewardFacts } from "@/features/public/public-reward-facts";
import {
  PUBLIC_OG_IMAGE_CONTENT_TYPE,
  PUBLIC_OG_IMAGE_SIZE,
  PublicOgCard,
} from "@/features/public/public-og-card";
import { slugify } from "@/features/public/public-slug";

export const size = PUBLIC_OG_IMAGE_SIZE;
export const contentType = PUBLIC_OG_IMAGE_CONTENT_TYPE;

export function generateStaticParams() {
  return GENERATED_PUBLIC_LOCALES.flatMap((locale) =>
    listPublicListings().map((listing) => ({
      locale,
      merchant: slugify(listing.merchantName),
      offerId: listing.id,
    })),
  );
}

export const dynamicParams = false;

interface OfferOgImageProps {
  params: Promise<{ locale: string; merchant: string; offerId: string }>;
}

/**
 * The offer page's share card. `rewardLine` is built from the same
 * `computeOfferRewardFacts` the page body uses — genuine face value and
 * points price together, per docs/11-seo-aeo-geo.md's "points-pricing trap"
 * (never the points figure alone, dressed up as the headline).
 */
export default async function OfferOgImage({ params }: OfferOgImageProps) {
  const { locale: rawLocale, offerId } = await params;
  const locale = requirePublicLocale(rawLocale);
  const listing = getPublicListing(offerId);
  if (!listing) {
    notFound();
  }

  const config = publicLocaleConfig(locale);
  const t = getPublicTranslator(config.intlLocale);
  const facts = computeOfferRewardFacts(listing, config);

  return new ImageResponse(
    <PublicOgCard
      eyebrow={t("offer.eyebrow")}
      title={listing.title}
      merchantName={listing.merchantName}
      rewardLine={facts.headline}
    />,
    { ...PUBLIC_OG_IMAGE_SIZE },
  );
}
