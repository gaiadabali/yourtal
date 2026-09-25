import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import {
  GENERATED_PUBLIC_LOCALES,
  publicLocaleConfig,
  requirePublicLocale,
} from "@/features/public/public-locale";
import {
  PUBLIC_INFO_SLUGS,
  isPublicInfoSlug,
  publicInfoPage,
} from "@/features/public/public-info-pages";
import {
  PUBLIC_OG_IMAGE_CONTENT_TYPE,
  PUBLIC_OG_IMAGE_SIZE,
  PublicPageOgCard,
} from "@/features/public/public-og-card";

export function generateStaticParams() {
  return GENERATED_PUBLIC_LOCALES.flatMap((locale) =>
    PUBLIC_INFO_SLUGS.map((page) => ({ locale, page })),
  );
}

export const dynamicParams = false;

export const size = PUBLIC_OG_IMAGE_SIZE;
export const contentType = PUBLIC_OG_IMAGE_CONTENT_TYPE;

interface InfoOgImageProps {
  params: Promise<{ locale: string; page: string }>;
}

export default async function InfoOgImage({ params }: InfoOgImageProps) {
  const { locale: rawLocale, page: slug } = await params;
  const config = publicLocaleConfig(requirePublicLocale(rawLocale));
  if (!isPublicInfoSlug(slug)) notFound();
  const page = publicInfoPage(config.intlLocale, slug);

  return new ImageResponse(
    <PublicPageOgCard
      eyebrow={config.countryName}
      title={page.title}
      description={page.description}
    />,
    { ...PUBLIC_OG_IMAGE_SIZE },
  );
}
