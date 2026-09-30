import { feedBrowseQuerySchema, feedSortSchema, type FeedSort } from "@yourtal/contracts/feed";
import { INTEREST_TAXONOMY } from "@yourtal/contracts/interest/taxonomy";

/** 13.13/13.12.a: how Home's grid is narrowed and ordered. Kept in the URL. */
export const FEED_SORTS = feedSortSchema.options;
export type { FeedSort };

export interface BrowseQuery {
  readonly category: string | null;
  readonly tags: readonly string[];
  readonly sort: FeedSort;
}

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Unknown categories, tags and sorts are dropped, never passed on to the API. */
export function parseBrowseQuery(params: SearchParams): BrowseQuery {
  const category = first(params["category"]);
  const sort = first(params["sort"]);
  const tags = (first(params["tags"]) ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(
      (tag, index, all) => tag !== "" && INTEREST_TAXONOMY.has(tag) && all.indexOf(tag) === index,
    )
    .slice(0, 8);
  return {
    category:
      category !== undefined && feedBrowseQuerySchema.shape.category.safeParse(category).success
        ? category
        : null,
    tags,
    sort: FEED_SORTS.includes(sort as FeedSort) ? (sort as FeedSort) : "for_you",
  };
}

/** The Home URL for a query; defaults are left out so "All" is plain `/home`. */
export function browseHref(query: BrowseQuery): string {
  const params = new URLSearchParams();
  if (query.category) params.set("category", query.category);
  if (query.tags.length > 0) params.set("tags", query.tags.join(","));
  if (query.sort !== "for_you") params.set("sort", query.sort);
  const qs = params.toString();
  return qs === "" ? "/home" : `/home?${qs}`;
}

/** `GET /api/feed`'s query for the long-video grid. */
export function feedApiPath(query: BrowseQuery, kind: "long_form" | "quick"): string {
  const params = new URLSearchParams({ surface: "home", kind });
  if (query.category) params.set("category", query.category);
  if (query.tags.length > 0) params.set("tags", query.tags.join(","));
  if (query.sort !== "for_you") params.set("sort", query.sort);
  return `/api/feed?${params.toString()}`;
}
