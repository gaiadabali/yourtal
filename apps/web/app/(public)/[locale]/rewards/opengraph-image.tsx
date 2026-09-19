import { ImageResponse } from "next/og";
import { listPublicListings } from "@/features/public/public-listing-data";
import {
  GENERATED_PUBLIC_LOCALES,
  publicLocaleConfig,
  requirePublicLocale,
} from "@/features/public/public-locale";
import { getPublicTranslator } from "@/features/public/public-i18n";
import {
  PUBLIC_OG_IMAGE_CONTENT_TYPE,
  PUBLIC_OG_IMAGE_SIZE,
  PublicOgCard,
} from "@/features/public/public-og-card";

export const size = PUBLIC_OG_IMAGE_SIZE;
export const contentType = PUBLIC_OG_IMAGE_CONTENT_TYPE;

export function generateStaticParams() {
  return GENERATED_PUBLIC_LOCALES.map((locale) => ({ locale }));
}

export const dynamicParams = false;

interface CatalogueOgImageProps {
  params: Promise<{ locale: string }>;
}

/**
 * The catalogue hub's share card. There is no single entity here, so the
 * honesty-critical line is a genuine count of live offers in the catalogue
 * at build time — never a specific reward figure that belongs to one
 * listing, which would misattribute it to the whole catalogue.
 */
export default async function CatalogueOgImage({ params }: CatalogueOgImageProps) {
  const locale = requirePublicLocale((await params).locale);
  const config = publicLocaleConfig(locale);
  const t = getPublicTranslator(config.intlLocale);
  const count = listPublicListings(locale).length;
  const rewardLine = `${count} ${t("merchant.offersHeading").toLowerCase()}`;

  return new ImageResponse(
    <PublicOgCard
      eyebrow="YourTal"
      title={t("catalogue.title")}
      merchantName={config.countryName}
      rewardLine={rewardLine}
    />,
    { ...PUBLIC_OG_IMAGE_SIZE },
  );
}
