import type { FacetCount } from "@yourtal/contracts/interest/tags";
import type { BrandFacet, ListingFacets, ListingSort } from "@yourtal/contracts/listing/browse";
import type { ListingRow } from "./listing-assembler";

/**
 * 13.12.b: the in-memory half of the store browse. The SQL `WHERE` has
 * already applied the walls and the non-facet filters; this applies the three
 * facet filters (category, brand, tags), counts the facets, sorts and pages.
 * The walled, active catalogue per region is small (hundreds of rows), so one
 * bounded read beats three facet GROUP BYs that must each repeat the walls.
 */
export interface FacetFilter {
  readonly category?: string | undefined;
  readonly brands?: readonly string[] | undefined;
  readonly tags?: readonly string[] | undefined;
}

export interface SortValues {
  /** Live points price, falling back to the row's cached price. */
  readonly priceOf: (row: ListingRow) => number;
  /** Vouchers already taken from this listing (total minus unallocated). */
  readonly takenOf: (row: ListingRow) => number;
}

const tagsOf = (row: ListingRow): readonly string[] => (Array.isArray(row.tags) ? row.tags : []);

const matchesCategory = (row: ListingRow, f: FacetFilter) =>
  f.category === undefined || row.category === f.category;
const matchesBrand = (row: ListingRow, f: FacetFilter) =>
  f.brands === undefined || f.brands.includes(row.merchantId);
const matchesTags = (row: ListingRow, f: FacetFilter) =>
  f.tags === undefined || tagsOf(row).some((tag) => f.tags?.includes(tag) === true);

export function matchesFacets(row: ListingRow, f: FacetFilter): boolean {
  return matchesCategory(row, f) && matchesBrand(row, f) && matchesTags(row, f);
}

function countBy(values: readonly string[]): FacetCount[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** Each facet ignores its own filter and honours the other two. */
export function listingFacets(rows: readonly ListingRow[], f: FacetFilter): ListingFacets {
  const categories = countBy(
    rows.filter((r) => matchesBrand(r, f) && matchesTags(r, f)).map((r) => r.category),
  );
  const tags = countBy(
    rows.filter((r) => matchesCategory(r, f) && matchesBrand(r, f)).flatMap(tagsOf),
  );
  const brandRows = rows.filter((r) => matchesCategory(r, f) && matchesTags(r, f));
  const names = new Map(brandRows.map((r) => [r.merchantId, r.merchantName]));
  const brands: BrandFacet[] = countBy(brandRows.map((r) => r.merchantId)).map((bucket) => ({
    ...bucket,
    label: names.get(bucket.value) ?? bucket.value,
  }));
  return { categories, tags, brands };
}

export function sortRows(
  rows: readonly ListingRow[],
  sort: ListingSort,
  values: SortValues,
): ListingRow[] {
  const byId = (a: ListingRow, b: ListingRow) => a.id.localeCompare(b.id);
  const compare: Record<ListingSort, (a: ListingRow, b: ListingRow) => number> = {
    popular: (a, b) => values.takenOf(b) - values.takenOf(a) || byId(a, b),
    newest: (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || byId(a, b),
    points_asc: (a, b) => values.priceOf(a) - values.priceOf(b) || byId(a, b),
    points_desc: (a, b) => values.priceOf(b) - values.priceOf(a) || byId(a, b),
    ending_soon: (a, b) => a.expiresAt.getTime() - b.expiresAt.getTime() || byId(a, b),
  };
  return [...rows].sort(compare[sort]);
}

/** Cursor paging over a sorted list: the page after `startingAfter`, plus one to answer `hasMore`. */
export function pageAfter<T extends { readonly id: string }>(
  sorted: readonly T[],
  startingAfter: string | undefined,
  limit: number,
): { page: T[]; hasMore: boolean } {
  const start =
    startingAfter === undefined ? 0 : sorted.findIndex((row) => row.id === startingAfter) + 1;
  // An unknown cursor (the row left the set) restarts nothing: an empty page, not page one again.
  if (startingAfter !== undefined && start === 0) return { page: [], hasMore: false };
  const slice = sorted.slice(start, start + limit + 1);
  return { page: slice.slice(0, limit), hasMore: slice.length > limit };
}
