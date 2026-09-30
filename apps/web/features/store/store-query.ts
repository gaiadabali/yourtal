import { LISTING_SORTS, type ListingSort } from "@yourtal/contracts/listing/listing-browse-values";
import {
  LISTING_CATEGORIES,
  type ListingCategory,
} from "@yourtal/contracts/listing/listing-values";
import { INTEREST_TAXONOMY } from "@yourtal/contracts/interest/taxonomy";

/**
 * 13.15: the shop's filters, all kept in the URL. `where` is "Where to use
 * it": picking in-store or online also includes vouchers good for both.
 */
export type StoreWhere = "in_store" | "online";

export interface StoreQuery {
  readonly q: string;
  readonly category: ListingCategory | null;
  readonly where: StoreWhere | null;
  readonly brands: readonly string[];
  readonly tags: readonly string[];
  readonly minPoints: number | null;
  readonly maxPoints: number | null;
  readonly location: string | null;
  readonly sort: ListingSort;
  /** Cursor: the last listing id of the previous page. */
  readonly after: string | null;
}

export const EMPTY_STORE_QUERY: StoreQuery = {
  q: "",
  category: null,
  where: null,
  brands: [],
  tags: [],
  minPoints: null,
  maxPoints: null,
  location: null,
  sort: "popular",
  after: null,
};

export const STORE_SORTS = LISTING_SORTS;

function oneOf<T extends string>(values: readonly T[], value: string | undefined): T | null {
  return value !== undefined && (values as readonly string[]).includes(value) ? (value as T) : null;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function list(value: string | undefined, keep: (item: string) => boolean, max: number): string[] {
  const items = (value ?? "").split(",").map((item) => item.trim());
  return [...new Set(items.filter((item) => item !== "" && keep(item)))].slice(0, max);
}

function points(value: string | undefined): number | null {
  if (value === undefined || !/^\d{1,9}$/.test(value)) return null;
  return Number(value);
}

/** Anything unknown is dropped, never passed on. */
export function parseStoreQuery(params: SearchParams): StoreQuery {
  const q = (first(params["q"]) ?? "").trim().slice(0, 200);
  const category = oneOf(LISTING_CATEGORIES, first(params["category"]));
  const where = first(params["where"]);
  const sort = oneOf(LISTING_SORTS, first(params["sort"]));
  const location = (first(params["location"]) ?? "").trim();
  const after = first(params["after"]);
  let minPoints = points(first(params["min"]));
  let maxPoints = points(first(params["max"]));
  if (minPoints !== null && maxPoints !== null && minPoints > maxPoints) {
    [minPoints, maxPoints] = [maxPoints, minPoints];
  }
  return {
    q,
    category,
    where: where === "in_store" || where === "online" ? where : null,
    brands: list(first(params["brand"]), (id) => UUID.test(id), 20),
    tags: list(first(params["tags"]), (id) => INTEREST_TAXONOMY.has(id), 8),
    minPoints,
    maxPoints,
    location: location !== "" && location.length <= 60 ? location : null,
    sort: sort ?? "popular",
    after: after !== undefined && UUID.test(after) ? after : null,
  };
}

function toParams(query: StoreQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.category) params.set("category", query.category);
  if (query.where) params.set("where", query.where);
  if (query.brands.length > 0) params.set("brand", query.brands.join(","));
  if (query.tags.length > 0) params.set("tags", query.tags.join(","));
  if (query.minPoints !== null) params.set("min", String(query.minPoints));
  if (query.maxPoints !== null) params.set("max", String(query.maxPoints));
  if (query.location) params.set("location", query.location);
  if (query.sort !== "popular") params.set("sort", query.sort);
  if (query.after) params.set("after", query.after);
  return params;
}

/** A shop URL. Any change of filter starts again from the first page. */
export function storeHref(query: StoreQuery, base = "/store"): string {
  const qs = toParams(query).toString();
  return qs === "" ? base : `${base}?${qs}`;
}

export function withFilters(query: StoreQuery, change: Partial<StoreQuery>): StoreQuery {
  return { ...query, ...change, after: change.after ?? null };
}

export function activeFilterCount(query: StoreQuery): number {
  return (
    (query.where ? 1 : 0) +
    query.brands.length +
    query.tags.length +
    (query.minPoints !== null || query.maxPoints !== null ? 1 : 0) +
    (query.location ? 1 : 0)
  );
}

/** `GET /api/store/listings`'s query (13.12.b). `where` has no API param yet: the page narrows it. */
export function listingsApiPath(query: StoreQuery, pageSize: number, merchantId?: string): string {
  const params = new URLSearchParams({ limit: String(pageSize), sort: query.sort });
  if (merchantId) params.set("merchantId", merchantId);
  if (query.q) params.set("q", query.q);
  if (query.category) params.set("category", query.category);
  if (query.brands.length > 0) params.set("brand", query.brands.join(","));
  if (query.tags.length > 0) params.set("tags", query.tags.join(","));
  if (query.minPoints !== null) params.set("minPoints", String(query.minPoints));
  if (query.maxPoints !== null) params.set("maxPoints", String(query.maxPoints));
  if (query.location) params.set("district", query.location);
  if (query.after) params.set("startingAfter", query.after);
  return `/api/store/listings?${params.toString()}`;
}
