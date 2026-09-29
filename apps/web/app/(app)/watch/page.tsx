import { getTranslations } from "next-intl/server";
import { EmptyState } from "@yourtal/ui/empty-state";
import { ErrorState } from "@yourtal/ui/error-state";
import { listWatchItems } from "@/features/watch/watch-data";
import { WatchGrid } from "@/features/watch/watch-grid";
import { getDisplayLocale } from "@/i18n/get-locale";

/**
 * Watch (11.7.d, founder demo): a YouTube-style grid of the long-form
 * campaigns from the feed, each linking to `/watch/[campaignId]` (agent D's
 * rebuilt watch page owns everything past this point). Home's own vertical
 * feed (`/home`) stays the swipe surface for teasers and in-feed Quick
 * earning; this tab is the browse-and-pick destination `/quick` used to
 * stand in for before it redirected to Home.
 */
export default async function WatchPage() {
  const [result, locale, t, feedT] = await Promise.all([
    listWatchItems(),
    getDisplayLocale(),
    getTranslations("watch"),
    getTranslations("feed"),
  ]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold text-fg">{t("title")}</h1>
      {!result.ok ? (
        <ErrorState
          title={t("error.heading")}
          description={t("error.body")}
          retry={
            <a href="/watch" className="text-label font-sans font-semibold text-accent">
              {t("error.retry")}
            </a>
          }
        />
      ) : result.data.length === 0 ? (
        <EmptyState title={t("empty.heading")} description={t("empty.body")} />
      ) : (
        <WatchGrid items={result.data} t={feedT} locale={locale} />
      )}
    </div>
  );
}
