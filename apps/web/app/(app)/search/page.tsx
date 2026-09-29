import { ErrorState } from "@yourtal/ui/error-state";
import { EmptyState } from "@yourtal/ui/empty-state";
import { PageContainer } from "@yourtal/ui/page-container";
import { PageHeader } from "@yourtal/ui/page-header";
import { Section } from "@yourtal/ui/section";
import { search } from "@/features/search/search-data";
import { getSearchTranslator } from "@/features/search/search-i18n";
import { SearchCampaignCard } from "@/features/search/search-campaign-card";
import { SearchChannelRow } from "@/features/search/search-channel-row";
import { SearchListingCard } from "@/features/search/search-listing-card";
import { getDisplayLocale } from "@/i18n/get-locale";

/**
 * 11.7.b: `/search?q=` — three sections (campaigns, channels, rewards)
 * from `GET /api/search` (7.7.c), the top bar's own search form target
 * (`features/shell/top-bar.tsx`). Region- and audience-walled server-side
 * (`resolveCatalogueScope`), same as the store catalogue — this page
 * renders whatever the API returns and does no filtering of its own.
 */
export default async function SearchPage(props: PageProps<"/search">) {
  const searchParams = await props.searchParams;
  const rawQuery = searchParams["q"];
  const query = (Array.isArray(rawQuery) ? rawQuery[0] : rawQuery)?.trim() ?? "";

  const locale = await getDisplayLocale();
  const t = getSearchTranslator(locale);

  if (query === "") {
    return (
      <PageContainer>
        <PageHeader title={t("pageTitle")} />
        <EmptyState title={t("emptyQuery")} />
      </PageContainer>
    );
  }

  const result = await search(query);

  if (!result.ok) {
    return (
      <PageContainer>
        <PageHeader title={t("pageTitle")} />
        <ErrorState
          title={t("errorTitle")}
          retry={
            <a href={`/search?q=${encodeURIComponent(query)}`} className="text-label font-sans font-semibold text-accent">
              {t("retry")}
            </a>
          }
        />
      </PageContainer>
    );
  }

  const { campaigns, channels, listings } = result.data;
  const hasAnyResults = campaigns.length > 0 || channels.length > 0 || listings.length > 0;

  return (
    <PageContainer>
      <PageHeader title={t("pageTitle")} />
      {!hasAnyResults ? (
        <EmptyState title={t("noResults", { query })} />
      ) : (
        <div className="flex flex-col gap-6">
          {campaigns.length > 0 ? (
            <Section title={t("campaignsHeading")}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {campaigns.map((item) => (
                  <SearchCampaignCard key={item.campaignId} item={item} locale={locale} />
                ))}
              </div>
            </Section>
          ) : null}
          {channels.length > 0 ? (
            <Section title={t("channelsHeading")}>
              <div className="flex flex-col gap-1">
                {channels.map((channel) => (
                  <SearchChannelRow key={channel.businessId} channel={channel} />
                ))}
              </div>
            </Section>
          ) : null}
          {listings.length > 0 ? (
            <Section title={t("listingsHeading")}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {listings.map((listing) => (
                  <SearchListingCard key={listing.id} listing={listing} locale={locale} />
                ))}
              </div>
            </Section>
          ) : null}
        </div>
      )}
    </PageContainer>
  );
}
