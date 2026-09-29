import type { Metadata } from "next";
import { getPublicProofRoots } from "@/features/public/public-proof-data";
import {
  GENERATED_PUBLIC_LOCALES,
  publicLanguageAlternates,
  publicLocaleConfig,
  publicUrl,
  requirePublicLocale,
} from "@/features/public/public-locale";
import { getPublicTranslator } from "@/features/public/public-i18n";
import { PublicBreadcrumbs } from "@/features/public/public-breadcrumbs";
import { PublicTransparencyContent } from "@/features/public/public-transparency-content";

/**
 * `/[locale]/transparency` (11.3.c, requested by A) — every day's published
 * proof root, from `GET /api/proof/roots` (10.3.b), shown as the SAME root
 * the API returns so anyone can recompute a day's root against their own
 * copy of that day's entries and compare. `dynamicParams = false`: the same
 * page for both regions, nothing per-campaign to enumerate.
 */
export function generateStaticParams() {
  return GENERATED_PUBLIC_LOCALES.map((locale) => ({ locale }));
}

export const dynamicParams = false;
// Proof roots are read on an hourly timer (public-proof-data.ts) — this
// page revalidates on the same cadence rather than a shorter one that
// would never see fresher data anyway.
export const revalidate = 3600;

interface PublicTransparencyPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PublicTransparencyPageProps): Promise<Metadata> {
  const locale = requirePublicLocale((await params).locale);
  const t = getPublicTranslator(publicLocaleConfig(locale).intlLocale);
  const url = publicUrl(locale, "/transparency");

  return {
    title: t("transparency.title"),
    description: t("transparency.description"),
    alternates: { canonical: url, languages: publicLanguageAlternates("/transparency") },
  };
}

export default async function PublicTransparencyPage({ params }: PublicTransparencyPageProps) {
  const locale = requirePublicLocale((await params).locale);
  const config = publicLocaleConfig(locale);
  const t = getPublicTranslator(config.intlLocale);
  const roots = await getPublicProofRoots();

  return (
    <>
      <PublicBreadcrumbs
        navAriaLabel={t("breadcrumbNav.ariaLabel")}
        items={[
          { name: t("breadcrumb.home"), url: publicUrl(locale, "/") },
          { name: t("breadcrumb.transparency"), url: publicUrl(locale, "/transparency") },
        ]}
      />
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold text-fg">{t("transparency.heading")}</h1>
        <p className="text-sm text-fg-muted">{t("transparency.intro")}</p>
        <PublicTransparencyContent roots={roots} locale={config} />
      </div>
    </>
  );
}
