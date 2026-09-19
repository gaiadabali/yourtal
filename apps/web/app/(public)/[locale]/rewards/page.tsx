import type { Metadata } from "next";
import { listPublicListings } from "@/features/public/public-listing-data";
import {
  GENERATED_PUBLIC_LOCALES,
  publicLanguageAlternates,
  publicLocaleConfig,
  publicUrl,
  requirePublicLocale,
} from "@/features/public/public-locale";
import { getPublicTranslator } from "@/features/public/public-i18n";
import { PublicBreadcrumbs } from "@/features/public/public-breadcrumbs";
import { PublicCatalogueContent } from "@/features/public/public-catalogue-content";
import { buildCatalogueItemListJsonLd } from "@/features/public/public-jsonld";
import { PublicJsonLdScript } from "@/features/public/public-json-ld-script";
import { publicTwitterCard } from "@/features/public/public-twitter-card";
import { slugify } from "@/features/public/public-slug";

/**
 * `/[locale]/rewards` — the catalogue hub (YT-0431). The internal-linking
 * layer docs/11-seo-aeo-geo.md §2.3 calls for: every offer here links to
 * its merchant, and (per that offer's own page) every merchant lists its
 * live offers back. This ticket builds one flat hub, not the fuller
 * category/city hub tiers docs/11 §2.3–2.4 describe for a mature catalogue
 * — see this ticket's report for that scope call.
 */
export function generateStaticParams() {
  return GENERATED_PUBLIC_LOCALES.map((locale) => ({ locale }));
}

export const dynamicParams = false;

interface PublicCataloguePageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PublicCataloguePageProps): Promise<Metadata> {
  const locale = requirePublicLocale((await params).locale);
  const config = publicLocaleConfig(locale);
  const t = getPublicTranslator(config.intlLocale);
  const url = publicUrl(locale, "/rewards");
  const imageUrl = publicUrl(locale, "/rewards/opengraph-image");

  return {
    title: t("catalogue.title"),
    description: t("catalogue.description"),
    alternates: { canonical: url, languages: publicLanguageAlternates("/rewards") },
    openGraph: {
      title: t("catalogue.title"),
      description: t("catalogue.description"),
      url,
      type: "website",
    },
    twitter: publicTwitterCard({
      title: t("catalogue.title"),
      description: t("catalogue.description"),
      imageUrl,
    }),
  };
}

export default async function PublicCataloguePage({ params }: PublicCataloguePageProps) {
  const locale = requirePublicLocale((await params).locale);
  const config = publicLocaleConfig(locale);
  const t = getPublicTranslator(config.intlLocale);
  const listings = listPublicListings(locale);

  return (
    <>
      <PublicBreadcrumbs
        items={[
          { name: t("breadcrumb.home"), url: publicUrl(locale, "/") },
          { name: t("breadcrumb.catalogue"), url: publicUrl(locale, "/rewards") },
        ]}
      />
      <PublicCatalogueContent listings={listings} locale={locale} localeConfig={config} />
      <PublicJsonLdScript
        data={buildCatalogueItemListJsonLd(
          listings.map((listing) => ({
            name: listing.title,
            url: publicUrl(locale, `/rewards/${slugify(listing.merchantName)}/${listing.id}`),
          })),
        )}
      />
    </>
  );
}
