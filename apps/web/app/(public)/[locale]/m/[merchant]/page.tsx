import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicMerchant, listPublicMerchants } from "@/features/public/public-merchant";
import {
  GENERATED_PUBLIC_LOCALES,
  publicLocaleConfig,
  publicUrl,
  requirePublicLocale,
} from "@/features/public/public-locale";
import { getPublicTranslator } from "@/features/public/public-i18n";
import { PublicBreadcrumbs } from "@/features/public/public-breadcrumbs";
import { PublicMerchantContent } from "@/features/public/public-merchant-content";
import {
  buildMerchantLocalBusinessJsonLd,
  buildMerchantOrganizationJsonLd,
} from "@/features/public/public-jsonld";
import { PublicJsonLdScript } from "@/features/public/public-json-ld-script";
import { publicTwitterCard } from "@/features/public/public-twitter-card";

/**
 * `/[locale]/m/[merchant]` — the public merchant page (YT-0431,
 * `docs/11-seo-aeo-geo.md` §1's `/id/m/[merchant]`). See
 * `apps/web/features/public/public-merchant.ts` for why `[merchant]` is a
 * `merchantName` slug rather than a `Business.id` — there is no reliable
 * join between the two in this codebase's mock data.
 */
export function generateStaticParams() {
  return GENERATED_PUBLIC_LOCALES.flatMap((locale) =>
    listPublicMerchants(locale).map((merchant) => ({ locale, merchant: merchant.slug })),
  );
}

export const dynamicParams = false;

interface PublicMerchantPageProps {
  params: Promise<{ locale: string; merchant: string }>;
}

export async function generateMetadata({ params }: PublicMerchantPageProps): Promise<Metadata> {
  const { locale: rawLocale, merchant: merchantSlug } = await params;
  const locale = requirePublicLocale(rawLocale);
  const merchant = getPublicMerchant(merchantSlug, locale);
  if (!merchant) {
    notFound();
  }
  const url = publicUrl(locale, `/m/${merchant.slug}`);
  const description = `${merchant.name}'s campaigns and vouchers on YourTal.`;
  const imageUrl = publicUrl(locale, `/m/${merchant.slug}/opengraph-image`);

  return {
    title: `${merchant.name} | YourTal`,
    description,
    alternates: { canonical: url },
    openGraph: { title: merchant.name, url, type: "website" },
    twitter: publicTwitterCard({ title: merchant.name, description, imageUrl }),
  };
}

export default async function PublicMerchantPage({ params }: PublicMerchantPageProps) {
  const { locale: rawLocale, merchant: merchantSlug } = await params;
  const locale = requirePublicLocale(rawLocale);
  const merchant = getPublicMerchant(merchantSlug, locale);
  if (!merchant) {
    notFound();
  }

  const config = publicLocaleConfig(locale);
  const t = getPublicTranslator(config.intlLocale);
  const url = publicUrl(locale, `/m/${merchant.slug}`);
  const imageUrl = publicUrl(locale, `/m/${merchant.slug}/opengraph-image`);
  const localBusinessJsonLd = buildMerchantLocalBusinessJsonLd({
    merchant,
    organizationUrl: url,
    locale,
  });

  return (
    <>
      <PublicBreadcrumbs
        items={[
          { name: t("breadcrumb.home"), url: publicUrl(locale, "/") },
          { name: merchant.name, url },
        ]}
      />
      <PublicMerchantContent merchant={merchant} locale={locale} localeConfig={config} />
      <PublicJsonLdScript data={buildMerchantOrganizationJsonLd({ merchant, url, imageUrl })} />
      {localBusinessJsonLd && <PublicJsonLdScript data={localBusinessJsonLd} />}
    </>
  );
}
