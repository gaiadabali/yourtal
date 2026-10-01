import { getTranslations } from "next-intl/server";
import { MediaCard } from "@yourtal/ui/media-card";
import { BrowseControls } from "./browse-controls";
import { browseHref, type BrowseQuery } from "./browse-query";
import { formatFeedDuration, type FeedLocale } from "./feed-terms";
import type { BrowseItem, HomeBrowseData } from "./home-data";
import { VideoCard } from "./video-card";

export interface HomeBrowseProps {
  data: HomeBrowseData;
  query: BrowseQuery;
  locale: FeedLocale;
  /** e.g. "https://yourtal.com/au": Share links point at the public campaign page. */
  publicBase: string;
}

const GRID =
  "grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5";
const FOR_YOU_COUNT = 8;
const SHELF_COUNT = 4;

/**
 * 13.13: Home is a grid of long videos. On "All": a featured row, Continue
 * watching, a For you grid, then a shelf per category. With a category or
 * topics picked: one grid of what matches. Empty rows are left out.
 */
export async function HomeBrowse({ data, query, locale, publicBase }: HomeBrowseProps) {
  const t = await getTranslations("feed");
  const tx = await getTranslations("taxonomy.node");
  const saved = new Set(data.savedIds);
  const label = (id: string) => (tx.has(id) ? tx(id) : id);
  const card = (item: BrowseItem, size: "grid" | "feature" = "grid", priority = false) => (
    <VideoCard
      item={item}
      locale={locale}
      saved={saved.has(item.campaignId)}
      shareUrl={`${publicBase}/c/${item.campaignId}`}
      size={size}
      priority={priority}
    />
  );
  const isAll = query.category === null && query.tags.length === 0;

  const controls = (
    <BrowseControls
      query={query}
      categories={data.categories}
      tags={data.tags}
      hideEndingSoon={data.ageBand === "teen"}
    />
  );

  if (!isAll) {
    const heading = query.category ? label(query.category) : t("browse.results");
    return (
      <div className="flex flex-col gap-6">
        {controls}
        <section aria-labelledby="home-results" className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="home-results" className="font-display text-headline font-bold text-fg">
              {heading}
            </h2>
            <p className="text-body-sm font-sans text-fg-muted" aria-live="polite">
              {t("browse.count", { count: data.items.length })}
            </p>
          </div>
          {data.items.length === 0 ? (
            <div className="flex flex-col items-start gap-3 rounded-card border border-dashed border-border-subtle p-8">
              <p className="font-display text-title font-bold text-fg">{t("browse.noneHeading")}</p>
              <p className="text-body font-sans text-fg-muted">{t("browse.noneBody")}</p>
              <a
                href={browseHref({ category: query.category, tags: [], sort: "for_you" })}
                className="text-label font-sans font-semibold text-accent hover:underline"
              >
                {t("browse.clear")}
              </a>
            </div>
          ) : (
            <ul className={GRID}>
              {data.items.map((item, index) => (
                <li key={item.campaignId}>{card(item, "grid", index < 2)}</li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  const featured = data.items.slice(0, 3);
  const forYou = data.items.slice(3, 3 + FOR_YOU_COUNT);
  const shelves = data.categories
    .map((facet) => ({
      value: facet.value,
      items: data.items
        .filter((item) => item.contentCategory === facet.value)
        .slice(0, SHELF_COUNT),
    }))
    .filter((shelf) => shelf.items.length >= 2);

  return (
    <div className="flex flex-col gap-10">
      {controls}
      {featured.length > 0 ? (
        <section aria-label={t("browse.featured")} className="grid gap-x-6 gap-y-8 lg:grid-cols-3">
          <div className="lg:col-span-2">
            {featured[0] ? card(featured[0], "feature", true) : null}
          </div>
          <div className="grid gap-y-8 sm:grid-cols-2 sm:gap-x-4 lg:grid-cols-1">
            {featured.slice(1).map((item) => (
              <div key={item.campaignId}>{card(item)}</div>
            ))}
          </div>
        </section>
      ) : null}

      {data.continueWatching.length > 0 ? (
        <Shelf id="continue" title={t("rows.continue")}>
          <ul className="flex snap-x gap-4 overflow-x-auto pb-1 [scrollbar-width:thin]">
            {data.continueWatching.map((item) => (
              <li key={item.campaignId} className="w-64 shrink-0 snap-start">
                <MediaCard
                  href={`/watch/${item.campaignId}`}
                  poster={item.posterUrl}
                  posterAlt=""
                  aspect="16:9"
                  title={item.title}
                  durationLabel={formatFeedDuration(t, item.durationSeconds)}
                  channel={<span className="text-caption font-sans">{item.merchantName}</span>}
                  progress={Math.min(1, item.coveredSeconds / item.durationSeconds)}
                  progressLabel={t("item.progress", {
                    watched: formatFeedDuration(t, item.coveredSeconds),
                    total: formatFeedDuration(t, item.durationSeconds),
                  })}
                />
              </li>
            ))}
          </ul>
        </Shelf>
      ) : null}

      {forYou.length > 0 ? (
        <Shelf id="for-you" title={t("browse.forYou")}>
          <ul className={GRID}>
            {forYou.map((item) => (
              <li key={item.campaignId}>{card(item)}</li>
            ))}
          </ul>
        </Shelf>
      ) : null}

      {shelves.map((shelf) => (
        <Shelf
          key={shelf.value}
          id={`shelf-${shelf.value}`}
          title={label(shelf.value)}
          seeAll={{
            href: browseHref({ category: shelf.value, tags: [], sort: "for_you" }),
            label: t("browse.seeAll"),
            ariaLabel: t("browse.seeAllIn", { name: label(shelf.value) }),
          }}
        >
          <ul className={GRID}>
            {shelf.items.map((item) => (
              <li key={item.campaignId}>{card(item)}</li>
            ))}
          </ul>
        </Shelf>
      ))}
    </div>
  );
}

function Shelf({
  id,
  title,
  seeAll,
  children,
}: {
  id: string;
  title: string;
  seeAll?: { href: string; label: string; ariaLabel: string };
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4 border-t border-border-subtle pt-6">
        <h2 id={id} className="font-display text-headline font-bold text-fg">
          {title}
        </h2>
        {seeAll ? (
          <a
            href={seeAll.href}
            aria-label={seeAll.ariaLabel}
            className="text-label font-sans font-semibold text-accent hover:underline"
          >
            {seeAll.label}
          </a>
        ) : null}
      </div>
      {children}
    </section>
  );
}
