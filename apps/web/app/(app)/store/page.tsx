import { StoreBoardControls } from "@/features/store/store-board-controls";
import { parseStoreBoardParams, hasActiveStoreFilters } from "@/features/store/store-board-params";
import { listListings } from "@/features/store/store-data";
import { StoreEmptyState } from "@/features/store/store-empty-state";
import { listingLocations, listingMerchants } from "@/features/store/store-facets";
import { filterListings } from "@/features/store/store-filter";
import { StoreGrid } from "@/features/store/store-grid";
import { getRegionDisplayConfig } from "@/features/region/get-region";

/**
 * The Store browse grid (YT-0420) — `/store`, replacing the YT-0402
 * placeholder. docs/17-surfaces-and-roles.md §1: "Tokopedia product grid —
 * vouchers, digital goods, merchandise. Price in points, terms visible
 * before committing." Server Component per
 * docs/13b-typescript-standards.md §8: the only interactive piece is
 * `StoreBoardControls`, a leaf.
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

  const listings = await listListings();
  const visibleListings = filterListings(listings, params);
  const locationOptions = listingLocations(listings);
  const merchantOptions = listingMerchants(listings);
  const { locale } = await getRegionDisplayConfig();

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold text-fg">Store</h1>
      <StoreBoardControls locationOptions={locationOptions} merchantOptions={merchantOptions} />
      {visibleListings.length === 0 ? (
        <StoreEmptyState hasActiveFilters={hasActiveStoreFilters(params)} locale={locale} />
      ) : (
        <StoreGrid listings={visibleListings} locale={locale} />
      )}
    </div>
  );
}
