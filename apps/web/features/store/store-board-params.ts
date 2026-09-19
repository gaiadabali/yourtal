import * as z from "zod/mini";
import { DEFAULT_STORE_CATEGORY_FILTER, isStoreCategoryFilter } from "./store-category";
import { DEFAULT_STORE_PRICE_BAND_FILTER, isStorePriceBandFilter } from "./store-price-band";
import { STORE_LOCATION_ALL, STORE_MERCHANT_ALL } from "./store-facets";
import type { StoreCategoryFilter } from "./store-category";
import type { StorePriceBandFilter } from "./store-price-band";

/**
 * The Store browse grid's four filters live in the URL, not `useState`
 * (docs/13b-typescript-standards.md §8: "URL first ... shareable and
 * back-button-correct"), mirroring `campaign-board-params.ts`. `zod/mini`
 * is used rather than `zod` because this module is imported by the client
 * leaf `store-board-controls.tsx` — see that file's docstring, and
 * docs/13b §8's initial-JS budget, for why full Zod cannot appear here.
 *
 * `location` and `merchant` are not fixed enums (they are catalogue data —
 * see store-facets.ts), so they cannot be validated against a known list
 * the way `category` and `priceBand` are. Instead they are sanitised to a
 * bounded, trimmed string: a value that matches no listing simply produces
 * an empty result (the browse grid already has an empty state for that),
 * which is graceful degradation, not an error.
 */
const MAX_FACET_PARAM_LENGTH = 200;

const rawSearchParamValueSchema = z.optional(z.union([z.string(), z.array(z.string())]));

const storeBoardSearchParamsSchema = z.object({
  category: rawSearchParamValueSchema,
  priceBand: rawSearchParamValueSchema,
  location: rawSearchParamValueSchema,
  merchant: rawSearchParamValueSchema,
});

export interface StoreBoardParams {
  category: StoreCategoryFilter;
  priceBand: StorePriceBandFilter;
  location: string;
  merchant: string;
}

const DEFAULT_STORE_BOARD_PARAMS: StoreBoardParams = {
  category: DEFAULT_STORE_CATEGORY_FILTER,
  priceBand: DEFAULT_STORE_PRICE_BAND_FILTER,
  location: STORE_LOCATION_ALL,
  merchant: STORE_MERCHANT_ALL,
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function sanitiseFacetParam(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > MAX_FACET_PARAM_LENGTH) {
    return fallback;
  }
  return trimmed;
}

export function parseStoreBoardParams(
  searchParams: Record<string, string | string[] | undefined>,
): StoreBoardParams {
  const raw = storeBoardSearchParamsSchema.parse(searchParams);

  const categoryCandidate = firstValue(raw.category) ?? "";
  const category = isStoreCategoryFilter(categoryCandidate)
    ? categoryCandidate
    : DEFAULT_STORE_CATEGORY_FILTER;

  const priceBandCandidate = firstValue(raw.priceBand) ?? "";
  const priceBand = isStorePriceBandFilter(priceBandCandidate)
    ? priceBandCandidate
    : DEFAULT_STORE_PRICE_BAND_FILTER;

  const location = sanitiseFacetParam(firstValue(raw.location), STORE_LOCATION_ALL);
  const merchant = sanitiseFacetParam(firstValue(raw.merchant), STORE_MERCHANT_ALL);

  return { category, priceBand, location, merchant };
}

/**
 * Builds the query string for the browse grid with one or more fields
 * changed, preserving the rest — used by `StoreBoardControls` so changing
 * one filter never drops the others from the URL.
 */
export function buildStoreBoardQuery(
  current: StoreBoardParams,
  update: Partial<StoreBoardParams>,
): string {
  const next: StoreBoardParams = { ...current, ...update };
  const params = new URLSearchParams();
  if (next.category !== DEFAULT_STORE_BOARD_PARAMS.category) {
    params.set("category", next.category);
  }
  if (next.priceBand !== DEFAULT_STORE_BOARD_PARAMS.priceBand) {
    params.set("priceBand", next.priceBand);
  }
  if (next.location !== DEFAULT_STORE_BOARD_PARAMS.location) {
    params.set("location", next.location);
  }
  if (next.merchant !== DEFAULT_STORE_BOARD_PARAMS.merchant) {
    params.set("merchant", next.merchant);
  }
  const query = params.toString();
  return query.length > 0 ? `?${query}` : "";
}

/** Whether any filter is narrowing the board away from its default (all listings). */
export function hasActiveStoreFilters(params: StoreBoardParams): boolean {
  return (
    params.category !== DEFAULT_STORE_BOARD_PARAMS.category ||
    params.priceBand !== DEFAULT_STORE_BOARD_PARAMS.priceBand ||
    params.location !== DEFAULT_STORE_BOARD_PARAMS.location ||
    params.merchant !== DEFAULT_STORE_BOARD_PARAMS.merchant
  );
}
