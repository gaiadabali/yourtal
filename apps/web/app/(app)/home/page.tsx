import { getTranslations } from "next-intl/server";
import { EmptyState } from "@yourtal/ui/empty-state";
import { ErrorState } from "@yourtal/ui/error-state";
import { parseBrowseQuery } from "@/features/feed/browse-query";
import { getHomeBrowse } from "@/features/feed/home-data";
import { HomeBrowse } from "@/features/feed/home-browse";
import { PUBLIC_SITE_URL } from "@/features/public/public-locale";
import { getRegion } from "@/features/region/get-region";
import { getDisplayLocale } from "@/i18n/get-locale";

export interface HomePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Home (13.13): long videos only, in a grid, narrowed by category, topics and
 * sort from the URL. Shorts have their own tab. The region comes from the
 * signed-in account on the server, never from this page.
 */
export default async function HomePage({ searchParams }: HomePageProps) {
  const query = parseBrowseQuery(await searchParams);
  const [region, locale, t, result] = await Promise.all([
    getRegion(),
    getDisplayLocale(),
    getTranslations("feed"),
    getHomeBrowse(query),
  ]);

  return (
    <div className="flex flex-col gap-4 px-gutter-sm pb-10 md:px-gutter-md">
      <h1 className="sr-only">{t("title")}</h1>
      {!result.ok ? (
        <div className="pt-6">
          <ErrorState
            title={t("error.heading")}
            description={t("error.body")}
            retry={
              <a href="/home" className="text-label font-sans font-semibold text-accent">
                {t("error.retry")}
              </a>
            }
          />
        </div>
      ) : result.data.items.length === 0 && result.data.categories.length === 0 ? (
        <div className="pt-6">
          <EmptyState title={t("empty.heading")} description={t("empty.body")} />
        </div>
      ) : (
        <HomeBrowse
          data={result.data}
          query={query}
          locale={locale}
          publicBase={`${PUBLIC_SITE_URL}/${region === "AU" ? "au" : "id"}`}
        />
      )}
    </div>
  );
}
