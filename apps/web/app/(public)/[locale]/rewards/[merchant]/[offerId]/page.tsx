import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicListing, listPublicListings } from "@/features/public/public-listing-data";
import {
  GENERATED_PUBLIC_LOCALES,
  publicLocaleConfig,
  publicUrl,
  requirePublicLocale,
} from "@/features/public/public-locale";
import { getPublicTranslator } from "@/features/public/public-i18n";
import { PublicBreadcrumbs } from "@/features/public/public-breadcrumbs";
import { PublicOfferContent } from "@/features/public/public-offer-content";
import { buildOfferProductJsonLd } from "@/features/public/public-jsonld";
import { PublicJsonLdScript } from "@/features/public/public-json-ld-script";
import { slugify } from "@/features/public/public-slug";

/**
 * `/[locale]/rewards/[merchant]/[offerId]` — the public voucher/offer page
 * (YT-0431, `docs/11-seo-aeo-geo.md` §1's `/id/rewards/[merchant]/[offer]`).
 * `[merchant]` is `slugify(listing.merchantName)`, generated alongside
 * `[offerId]` below so only the canonical merchant/offer pairing is ever a
 * real, statically-generated URL (`dynamicParams = false` 404s any other
 * combination at the router).
 */
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

interface PublicOfferPageProps {
  params: Promise<{ locale: string; merchant: string; offerId: string }>;
}

export async function generateMetadata({ params }: PublicOfferPageProps): Promise<Metadata> {
  const { locale: rawLocale, offerId } = await params;
  const locale = requirePublicLocale(rawLocale);
  const listing = getPublicListing(offerId);
  if (!listing) {
    notFound();
  }
  const merchantSlug = slugify(listing.merchantName);
  const url = publicUrl(locale, `/rewards/${merchantSlug}/${listing.id}`);

  return {
    title: `${listing.title} — ${listing.merchantName} | YourTal`,
    description: listing.description,
    alternates: { canonical: url },
    openGraph: { title: listing.title, description: listing.description, url, type: "website" },
  };
}

export default async function PublicOfferPage({ params }: PublicOfferPageProps) {
  const { locale: rawLocale, offerId } = await params;
  const locale = requirePublicLocale(rawLocale);
  const listing = getPublicListing(offerId);
  if (!listing) {
    notFound();
  }

  const config = publicLocaleConfig(locale);
  const t = getPublicTranslator(config.intlLocale);
  const merchantSlug = slugify(listing.merchantName);
  const merchantUrl = publicUrl(locale, `/m/${merchantSlug}`);
  const url = publicUrl(locale, `/rewards/${merchantSlug}/${listing.id}`);
  const imageUrl = publicUrl(locale, `/rewards/${merchantSlug}/${listing.id}/opengraph-image`);

  return (
    <>
      <PublicBreadcrumbs
        items={[
          { name: t("breadcrumb.home"), url: publicUrl(locale, "/") },
          { name: t("breadcrumb.catalogue"), url: publicUrl(locale, "/rewards") },
          { name: listing.merchantName, url: merchantUrl },
          { name: listing.title, url },
        ]}
      />
      <PublicOfferContent
        listing={listing}
        locale={config}
        merchantHref={`/${locale}/m/${merchantSlug}`}
      />
      <PublicJsonLdScript
        data={buildOfferProductJsonLd({ listing, url, imageUrl, merchantUrl, locale: config })}
      />
    </>
  );
}
