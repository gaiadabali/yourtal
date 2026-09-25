import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  GENERATED_PUBLIC_LOCALES,
  publicLanguageAlternates,
  publicLocaleConfig,
  publicUrl,
  requirePublicLocale,
} from "@/features/public/public-locale";
import { getPublicTranslator } from "@/features/public/public-i18n";
import { PublicBreadcrumbs } from "@/features/public/public-breadcrumbs";
import { PublicInfoContent } from "@/features/public/public-info-content";
import {
  PUBLIC_INFO_SLUGS,
  isPublicInfoSlug,
  publicInfoPage,
} from "@/features/public/public-info-pages";
import { buildFaqPageJsonLd } from "@/features/public/public-jsonld";
import { PublicJsonLdScript } from "@/features/public/public-json-ld-script";
import { publicTwitterCard } from "@/features/public/public-twitter-card";
import { isStaging } from "@/features/shell/app-env";

// Help, how points work, for business, terms and privacy: the same page in both regions.
export function generateStaticParams() {
  return GENERATED_PUBLIC_LOCALES.flatMap((locale) =>
    PUBLIC_INFO_SLUGS.map((page) => ({ locale, page })),
  );
}

export const dynamicParams = false;

interface PublicInfoRouteProps {
  params: Promise<{ locale: string; page: string }>;
}

async function resolve(params: PublicInfoRouteProps["params"]) {
  const { locale: rawLocale, page: slug } = await params;
  const locale = requirePublicLocale(rawLocale);
  if (!isPublicInfoSlug(slug)) notFound();
  const config = publicLocaleConfig(locale);
  return { locale, config, page: publicInfoPage(config.intlLocale, slug) };
}

export async function generateMetadata({ params }: PublicInfoRouteProps): Promise<Metadata> {
  const { locale, page } = await resolve(params);
  const path = `/${page.slug}`;
  const url = publicUrl(locale, path);
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: url, languages: publicLanguageAlternates(path) },
    openGraph: { title: page.title, description: page.description, url, type: "website" },
    twitter: publicTwitterCard({
      title: page.title,
      description: page.description,
      imageUrl: publicUrl(locale, `${path}/opengraph-image`),
    }),
  };
}

export default async function PublicInfoRoute({ params }: PublicInfoRouteProps) {
  const { locale, config, page } = await resolve(params);
  const t = getPublicTranslator(config.intlLocale);

  return (
    <>
      <PublicBreadcrumbs
        items={[
          { name: t("breadcrumb.home"), url: publicUrl(locale, "/") },
          { name: page.title, url: publicUrl(locale, `/${page.slug}`) },
        ]}
      />
      <PublicInfoContent
        page={page}
        locale={config.intlLocale}
        showDraftNotice={page.isLegal && isStaging()}
      />
      {page.slug === "help" ? (
        <PublicJsonLdScript
          data={buildFaqPageJsonLd(
            page.sections.map((s) => ({ question: s.heading, answer: s.body.join(" ") })),
          )}
        />
      ) : null}
    </>
  );
}
