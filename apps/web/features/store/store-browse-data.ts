import "server-only";

import type { PublicListing } from "@yourtal/contracts/listing";
import {
  listingBrowseResponseSchema,
  type BrandFacet,
  type ListingFacets,
} from "@yourtal/contracts/listing/browse";
import type { FacetCount } from "@yourtal/contracts/interest/tags";
import { apiFetch } from "@/lib/api/api-fetch";
import { listingHasDistrict } from "./listing-locations";
import { listingsApiPath, type StoreQuery } from "./store-query";

export const STORE_PAGE_SIZE = 24;

export interface StoreBrowseData {
  readonly listings: readonly PublicListing[];
  readonly total: number;
  readonly hasMore: boolean;
  readonly facets: ListingFacets;
  /** Districts on offer, for the location filter. */
  readonly locations: readonly string[];
}

/** 13.15.c: in-store or online also shows vouchers good for both. */
export function matchesWhere(listing: PublicListing, where: StoreQuery["where"]): boolean {
  return where === null || listing.channel === where || listing.channel === "both";
}

function count<T>(rows: readonly T[], keys: (row: T) => readonly string[]): FacetCount[] {
  const counts = new Map<string, number>();
  for (const row of rows)
    for (const key of new Set(keys(row))) counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts]
    .map(([value, n]) => ({ value, count: n }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function brandFacets(rows: readonly PublicListing[]): BrandFacet[] {
  const names = new Map(rows.map((row) => [row.merchantId, row.merchantName]));
  return count(rows, (row) => [row.merchantId]).map((facet) => ({
    ...facet,
    label: names.get(facet.value) ?? facet.value,
  }));
}

const SORTERS: Record<StoreQuery["sort"], (a: PublicListing, b: PublicListing) => number> = {
  popular: (a, b) => b.stockTotal - b.stockRemaining - (a.stockTotal - a.stockRemaining),
  newest: () => 0,
  points_asc: (a, b) => a.priceInPoints - b.priceInPoints,
  points_desc: (a, b) => b.priceInPoints - a.priceInPoints,
  ending_soon: (a, b) => a.expiresAt.localeCompare(b.expiresAt),
};

/** Same rules as 13.12.b's server filter, over one fetch, for a server that lacks it. */
function narrowLocally(all: readonly PublicListing[], query: StoreQuery): StoreBrowseData {
  const text = query.q.toLowerCase();
  const inText = (row: PublicListing) =>
    text === "" ||
    [row.title, row.merchantName, row.description].some((field) =>
      field.toLowerCase().includes(text),
    );
  const base = all.filter(
    (row) =>
      inText(row) &&
      matchesWhere(row, query.where) &&
      (query.location === null || listingHasDistrict(row, query.location)) &&
      (query.minPoints === null || row.priceInPoints >= query.minPoints) &&
      (query.maxPoints === null || row.priceInPoints <= query.maxPoints),
  );
  const byCategory = (row: PublicListing) =>
    query.category === null || row.category === query.category;
  const byBrand = (row: PublicListing) =>
    query.brands.length === 0 || query.brands.includes(row.merchantId);
  const byTags = (row: PublicListing) =>
    query.tags.length === 0 || query.tags.some((tag) => row.tags.includes(tag));
  const matching = base
    .filter((row) => byCategory(row) && byBrand(row) && byTags(row))
    .sort(SORTERS[query.sort]);
  const start = query.after ? matching.findIndex((row) => row.id === query.after) + 1 : 0;
  return {
    listings: matching.slice(start, start + STORE_PAGE_SIZE),
    total: matching.length,
    hasMore: start + STORE_PAGE_SIZE < matching.length,
    // Each facet ignores its own filter, as the server's does.
    facets: {
      categories: count(
        base.filter((row) => byBrand(row) && byTags(row)),
        (row) => [row.category],
      ),
      brands: brandFacets(base.filter((row) => byCategory(row) && byTags(row))),
      tags: count(
        base.filter((row) => byCategory(row) && byBrand(row)),
        (row) => row.tags,
      ),
    },
    locations: [...new Set(all.flatMap((row) => row.locations.map((l) => l.district)))].sort(),
  };
}

export async function browseStore(
  query: StoreQuery,
  merchantId?: string,
): Promise<{ ok: true; data: StoreBrowseData } | { ok: false }> {
  const result = await apiFetch(
    listingsApiPath(query, STORE_PAGE_SIZE, merchantId),
    listingBrowseResponseSchema,
  );
  if (!result.ok) return { ok: false };
  const page = result.data;
  const serverFiltered = page.facets.categories.length > 0 || page.data.length === 0;
  if (serverFiltered) {
    return {
      ok: true,
      data: {
        listings: page.data,
        total: page.total_count,
        hasMore: page.has_more,
        facets: page.facets,
        locations: [
          ...new Set(page.data.flatMap((row) => row.locations.map((l) => l.district))),
        ].sort(),
      },
    };
  }
  // An older server ignores the filters: read everything once and narrow here.
  const all = await apiFetch(
    `/api/store/listings?limit=100${merchantId ? `&merchantId=${merchantId}` : ""}`,
    listingBrowseResponseSchema,
  );
  if (!all.ok) return { ok: false };
  const rows = merchantId
    ? all.data.data.filter((row) => row.merchantId === merchantId)
    : all.data.data;
  return { ok: true, data: narrowLocally(rows, query) };
}
