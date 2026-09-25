import { ImageResponse } from "next/og";
import {
  GENERATED_PUBLIC_LOCALES,
  publicLocaleConfig,
  requirePublicLocale,
} from "@/features/public/public-locale";
import { getPublicTranslator } from "@/features/public/public-i18n";
import {
  PUBLIC_OG_IMAGE_CONTENT_TYPE,
  PUBLIC_OG_IMAGE_SIZE,
  PublicPageOgCard,
} from "@/features/public/public-og-card";

export const size = PUBLIC_OG_IMAGE_SIZE;
export const contentType = PUBLIC_OG_IMAGE_CONTENT_TYPE;

export function generateStaticParams() {
  return GENERATED_PUBLIC_LOCALES.map((locale) => ({ locale }));
}

export const dynamicParams = false;

interface LocaleOgImageProps {
  params: Promise<{ locale: string }>;
}

export default async function LocaleOgImage({ params }: LocaleOgImageProps) {
  const config = publicLocaleConfig(requirePublicLocale((await params).locale));
  const t = getPublicTranslator(config.intlLocale);

  return new ImageResponse(
    <PublicPageOgCard
      eyebrow={config.countryName}
      title={t("footer.tagline")}
      description={t("catalogue.description")}
    />,
    { ...PUBLIC_OG_IMAGE_SIZE },
  );
}
