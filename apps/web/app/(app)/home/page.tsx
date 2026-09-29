import { getTranslations } from "next-intl/server";
import { EmptyState } from "@yourtal/ui/empty-state";
import { ErrorState } from "@yourtal/ui/error-state";
import { getHomeFeed } from "@/features/feed/feed-data";
import { HomeFeed } from "@/features/feed/home-feed";
import { PUBLIC_SITE_URL } from "@/features/public/public-locale";
import { getRegion } from "@/features/region/get-region";
import { getDisplayLocale } from "@/i18n/get-locale";

/**
 * Home: the For You feed from the 7.7 ranking (11.4). Quick campaigns earn in
 * place; longer ones open the player. The feed's region comes from the
 * signed-in account on the server, never from this page.
 */
export default async function HomePage() {
  const [region, locale, t] = await Promise.all([
    getRegion(),
    getDisplayLocale(),
    getTranslations("feed"),
  ]);
  const result = await getHomeFeed(region);

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="sr-only">{t("title")}</h1>
      {!result.ok ? (
        <ErrorState
          title={t("error.heading")}
          description={t("error.body")}
          retry={
            <a href="/home" className="text-label font-sans font-semibold text-accent">
              {t("error.retry")}
            </a>
          }
        />
      ) : result.data.items.length === 0 &&
        result.data.rows.continue.length === 0 &&
        result.data.rows.saved.length === 0 ? (
        <EmptyState title={t("empty.heading")} description={t("empty.body")} />
      ) : (
        <HomeFeed
          data={result.data}
          locale={locale}
          publicBase={`${PUBLIC_SITE_URL}/${region === "AU" ? "au" : "id"}`}
        />
      )}
    </div>
  );
}
