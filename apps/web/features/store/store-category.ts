import type { Listing, ListingCategory } from "@yourtal/contracts/listing";

/**
 * Category filter for the Store browse grid (YT-0420). Spelled out rather
 * than derived from `listingCategorySchema.options`: this module is
 * reachable from the client leaf `store-board-controls.tsx`, and a *value*
 * import from `@yourtal/contracts/listing` drags the whole Zod runtime
 * (~96 KB gz) into the store bundle, which is exactly the mistake
 * docs/13b-typescript-standards.md §8's 170 KB initial-JS gate exists to
 * catch (see campaign-filter.ts for the same pattern and rationale).
 *
 * `satisfies` rejects a value that is not a real `ListingCategory`, and
 * `MissingCategory` fails to compile if a category is ever added to the
 * contract and not mirrored here.
 */
const LISTING_CATEGORIES = [
  "food_beverage",
  "retail",
  "digital_goods",
  "merchandise",
  "services",
] as const satisfies readonly ListingCategory[];

type MissingCategory = Exclude<ListingCategory, (typeof LISTING_CATEGORIES)[number]>;
const _allCategoriesCovered: MissingCategory extends never ? true : never = true;

export const STORE_CATEGORY_FILTER_VALUES = ["all", ...LISTING_CATEGORIES] as const;
export type StoreCategoryFilter = (typeof STORE_CATEGORY_FILTER_VALUES)[number];

export const DEFAULT_STORE_CATEGORY_FILTER: StoreCategoryFilter = "all";

const CATEGORY_LABELS: Record<ListingCategory, string> = {
  food_beverage: "Makanan & Minuman",
  retail: "Retail",
  digital_goods: "Produk Digital",
  merchandise: "Merchandise",
  services: "Jasa",
};

/** Indonesian display label for a listing's category (used on cards and the offer detail page). */
export function categoryLabel(category: ListingCategory): string {
  return CATEGORY_LABELS[category];
}

export const STORE_CATEGORY_FILTER_OPTIONS: ReadonlyArray<{
  key: StoreCategoryFilter;
  label: string;
}> = [
  { key: "all", label: "Semua kategori" },
  ...LISTING_CATEGORIES.map((category) => ({ key: category, label: CATEGORY_LABELS[category] })),
];

export function isStoreCategoryFilter(value: string): value is StoreCategoryFilter {
  return (STORE_CATEGORY_FILTER_VALUES as readonly string[]).includes(value);
}

export function filterListingsByCategory(
  listings: readonly Listing[],
  category: StoreCategoryFilter,
): Listing[] {
  if (category === "all") {
    return [...listings];
  }
  const wanted: ListingCategory = category;
  return listings.filter((listing) => listing.category === wanted);
}
