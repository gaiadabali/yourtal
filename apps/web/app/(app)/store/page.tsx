import { ErrorState } from "@yourtal/ui/error-state";
import { StoreBalanceChip } from "@/features/store/store-balance-chip";
import { StoreBoardControls } from "@/features/store/store-board-controls";
import { parseStoreBoardParams, hasActiveStoreFilters } from "@/features/store/store-board-params";
import { listListings } from "@/features/store/store-data";
import { StoreEmptyState } from "@/features/store/store-empty-state";
import { listingLocations, listingMerchants } from "@/features/store/store-facets";
import { filterListings } from "@/features/store/store-filter";
import { StoreGrid } from "@/features/store/store-grid";
import { getDisplayLocale } from "@/i18n/get-locale";
import { getStoreTranslator } from "@/features/store/store-i18n";
import { getWalletBalance } from "@/features/wallet/wallet-data";

/**
 * The Store browse grid (11.6.a) — `/store`. Server Component per
 * docs/13b-typescript-standards.md §8: the only interactive piece is
 * `StoreBoardControls`, a leaf.
 *
 * Every read is live (`listListings`/`getWalletBalance`, both real
 * `apiFetch` round trips) — no mock data, per Phase 11's "Done when". The
 * catalogue read and the balance read are independent: a wallet hiccup
 * degrades to no balance chip rather than blanking a grid the viewer can
 * still browse and buy from; a catalogue failure is fatal to the page,
 * since there is nothing to show without it.
 *
 * Unlike the earn board's `/`, the filter options here (merchant, location)
 * are dynamic catalogue data, not a fixed enum (see store-facets.ts), so
 * they cannot be computed without the listing list already in hand. That
 * makes an in-page `<Suspense>` boundary (as the earn board uses to render
 * its controls before its data resolves) the wrong shape for this page:
 * the controls themselves need the fetched data. This page instead awaits
 * once, at the top, and `app/(app)/store/loading.tsx` covers the
 * navigation-time loading state — the same structure
 * `campaign/[campaignId]/page.tsx` uses for the same reason.
 */
export default async function StorePage(props: PageProps<"/store">) {
  const searchParams = await props.searchParams;
  const params = parseStoreBoardParams(searchParams);

  const [listingsResult, balanceResult, locale] = await Promise.all([
    listListings(),
    getWalletBalance(),
    getDisplayLocale(),
  ]);
  const t = getStoreTranslator(locale);

  if (!listingsResult.ok) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <h1 className="text-2xl font-semibold text-fg">{t("pageTitle")}</h1>
        <ErrorState
          title={t("boardError.title")}
          description={t("boardError.description")}
          retry={
            <a href="/store" className="text-label font-sans font-semibold text-accent">
              {t("errorPanel.retryLabel")}
            </a>
          }
        />
      </div>
    );
  }

  const listings = listingsResult.data;
  const visibleListings = filterListings(listings, params);
  const locationOptions = listingLocations(listings, locale);
  const merchantOptions = listingMerchants(listings, locale);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-fg">{t("pageTitle")}</h1>
        {balanceResult.ok ? (
          <StoreBalanceChip points={balanceResult.data.availablePoints} locale={locale} />
        ) : null}
      </div>
      <StoreBoardControls locationOptions={locationOptions} merchantOptions={merchantOptions} />
      {visibleListings.length === 0 ? (
        <StoreEmptyState hasActiveFilters={hasActiveStoreFilters(params)} locale={locale} />
      ) : (
        <StoreGrid listings={visibleListings} locale={locale} />
      )}
    </div>
  );
}
