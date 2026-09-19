import type { Metadata } from "next";
import {
  GENERATED_PUBLIC_LOCALES,
  publicLocaleConfig,
  publicUrl,
  requirePublicLocale,
} from "@/features/public/public-locale";
import { getPublicTranslator } from "@/features/public/public-i18n";

export function generateStaticParams() {
  return GENERATED_PUBLIC_LOCALES.map((locale) => ({ locale }));
}

export const dynamicParams = false;

interface PublicHomePageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PublicHomePageProps): Promise<Metadata> {
  const locale = requirePublicLocale((await params).locale);
  const config = publicLocaleConfig(locale);
  const t = getPublicTranslator(config.intlLocale);
  return {
    title: `YourTal ${config.countryName}`,
    description: t("catalogue.description"),
    alternates: { canonical: publicUrl(locale, "/") },
  };
}

/**
 * `/[locale]` — the locale root this ticket's header links home to. Not one
 * of YT-0431's four required page types, but a link with nowhere to land is
 * worse than no link, and this is the natural top of the hub→spoke→hub
 * graph docs/11-seo-aeo-geo.md §2.3 describes (home → catalogue → offer →
 * merchant). Kept intentionally small: one link into the catalogue, which
 * is where the real content lives.
 */
export default async function PublicHomePage({ params }: PublicHomePageProps) {
  const locale = requirePublicLocale((await params).locale);
  const config = publicLocaleConfig(locale);
  const t = getPublicTranslator(config.intlLocale);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-fg">YourTal {config.countryName}</h1>
      <p className="text-sm text-fg-muted">{t("catalogue.description")}</p>
      <a href={`/${locale}/rewards`} className="text-sm font-medium text-fg hover:underline">
        {t("breadcrumb.catalogue")}
      </a>
    </div>
  );
}
