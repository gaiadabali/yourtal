import { ErrorState } from "@yourtal/ui/error-state";
import { EmptyState } from "@yourtal/ui/empty-state";
import { PUBLIC_SITE_URL } from "@/features/public/public-locale";
import { getRegion } from "@/features/region/get-region";
import { search } from "@/features/search/search-data";
import { getSearchTranslator } from "@/features/search/search-i18n";
import { SearchBox } from "@/features/search/search-box";
import { SearchCampaignCard } from "@/features/search/search-campaign-card";
import { SearchChannelRow } from "@/features/search/search-channel-row";
import { StoreVoucherCard } from "@/features/store/store-voucher-card";
import { VideoCard } from "@/features/feed/video-card";
import { getDisplayLocale } from "@/i18n/get-locale";

function Results({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} className="font-display text-headline font-bold text-fg">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * Search (11.7.b, 13.13): one query across long videos, Shorts, channels and
 * rewards, each in its own section, with the box on the page itself.
 */
export default async function SearchPage(props: PageProps<"/search">) {
  const searchParams = await props.searchParams;
  const rawQuery = searchParams["q"];
  const query = (Array.isArray(rawQuery) ? rawQuery[0] : rawQuery)?.trim() ?? "";
  const [locale, region] = await Promise.all([getDisplayLocale(), getRegion()]);
  const t = getSearchTranslator(locale);
  const publicBase = `${PUBLIC_SITE_URL}/${region === "AU" ? "au" : "id"}`;

  const header = (
    <>
      <h1 className="font-display text-headline font-bold text-fg">
        {query === "" ? t("pageTitle") : t("resultsFor", { query })}
      </h1>
      <SearchBox
        query={query}
        label={t("searchLabel")}
        placeholder={t("placeholder")}
        submitLabel={t("submit")}
      />
    </>
  );
  const shell = (children: React.ReactNode) => (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-gutter-sm py-6 md:px-gutter-md">
      {header}
      {children}
    </div>
  );

  if (query === "") return shell(<EmptyState title={t("emptyQuery")} />);

  const result = await search(query);
  if (!result.ok) {
    return shell(
      <ErrorState
        title={t("errorTitle")}
        retry={
          <a
            href={`/search?q=${encodeURIComponent(query)}`}
            className="text-label font-sans font-semibold text-accent"
          >
            {t("retry")}
          </a>
        }
      />,
    );
  }

  const { campaigns, channels, listings } = result.data;
  const videos = campaigns.filter((item) => item.kind === "long_form");
  const shorts = campaigns.filter((item) => item.kind === "quick");
  if (campaigns.length === 0 && channels.length === 0 && listings.length === 0) {
    return shell(<EmptyState title={t("noResults", { query })} />);
  }

  return shell(
    <div className="flex flex-col gap-10">
      {videos.length > 0 ? (
        <Results id="search-videos" title={t("videosHeading")}>
          <ul className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {videos.map((item) => (
              <li key={item.campaignId}>
                <VideoCard
                  item={item}
                  locale={locale}
                  saved={false}
                  shareUrl={`${publicBase}/c/${item.campaignId}`}
                />
              </li>
            ))}
          </ul>
        </Results>
      ) : null}
      {shorts.length > 0 ? (
        <Results id="search-shorts" title={t("shortsHeading")}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {shorts.map((item) => (
              <SearchCampaignCard key={item.campaignId} item={item} locale={locale} />
            ))}
          </div>
        </Results>
      ) : null}
      {channels.length > 0 ? (
        <Results id="search-channels" title={t("channelsHeading")}>
          <div className="flex flex-col gap-1">
            {channels.map((channel) => (
              <SearchChannelRow key={channel.businessId} channel={channel} />
            ))}
          </div>
        </Results>
      ) : null}
      {listings.length > 0 ? (
        <Results id="search-rewards" title={t("listingsHeading")}>
          <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
            {listings.map((listing) => (
              <li key={listing.id}>
                <StoreVoucherCard listing={listing} locale={locale} />
              </li>
            ))}
          </ul>
        </Results>
      ) : null}
    </div>,
  );
}
