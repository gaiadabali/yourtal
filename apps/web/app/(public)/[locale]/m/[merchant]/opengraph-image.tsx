import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { getPublicMerchant, listPublicMerchants } from "@/features/public/public-merchant";
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
  return GENERATED_PUBLIC_LOCALES.flatMap((locale) =>
    listPublicMerchants(locale).map((merchant) => ({ locale, merchant: merchant.slug })),
  );
}

export const dynamicParams = false;

interface MerchantOgImageProps {
  params: Promise<{ locale: string; merchant: string }>;
}

/**
 * The merchant page's share card. A merchant has no single reward figure
 * the way a campaign or offer does, so the honesty-critical line here is a
 * genuine count of its live campaigns and vouchers rather than a fabricated
 * headline number — never a number that implies a specific reward.
 */
export default async function MerchantOgImage({ params }: MerchantOgImageProps) {
  const { locale: rawLocale, merchant: merchantSlug } = await params;
  const locale = requirePublicLocale(rawLocale);
  const merchant = getPublicMerchant(merchantSlug, locale);
  if (!merchant) {
    notFound();
  }

  const config = publicLocaleConfig(locale);
  const t = getPublicTranslator(config.intlLocale);
  const summary = `${merchant.campaigns.length} ${t("merchant.campaignsHeading").toLowerCase()} · ${merchant.listings.length} ${t("merchant.offersHeading").toLowerCase()}`;

  return new ImageResponse(
    <PublicOgCard
      eyebrow={t("merchant.eyebrow")}
      title={merchant.name}
      merchantName={merchant.district ?? config.countryName}
      rewardLine={summary}
    />,
    { ...PUBLIC_OG_IMAGE_SIZE },
  );
}
