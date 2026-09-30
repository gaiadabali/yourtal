import { z } from "zod";
import { contentCategorySchema } from "@yourtal/jurisdiction/content-category";
import { regionSchema } from "../region/region";
import { campaignKindSchema } from "../campaign/campaign";
import {
  MAX_TAGS,
  csvListParam,
  facetCountSchema,
  interestTagSchema,
} from "../interest/interest-tags";

/**
 * 13.12.a: `GET /api/feed`'s browse query. Every filter runs on the server,
 * inside the region and audience walls, which no query param can widen.
 * `region` is only read for an anonymous caller; a signed-in caller's region
 * is their own.
 */
export const feedSurfaceSchema = z.enum(["home", "watch"]);
export type FeedSurface = z.infer<typeof feedSurfaceSchema>;

/** `for_you` is the personalised ranking; the others are plain orderings of the same walled set. */
export const feedSortSchema = z.enum(["for_you", "newest", "most_points", "ending_soon"]);
export type FeedSort = z.infer<typeof feedSortSchema>;

export const feedBrowseQuerySchema = z.object({
  surface: feedSurfaceSchema.default("home"),
  region: regionSchema.optional(),
  /** Home asks for `long_form`, Shorts for `quick`; omitted means both. */
  kind: campaignKindSchema.optional(),
  category: contentCategorySchema.optional(),
  /** Matches a campaign carrying ANY of these tags. */
  tags: csvListParam(interestTagSchema, MAX_TAGS),
  sort: feedSortSchema.default("for_you"),
});
export type FeedBrowseQuery = z.infer<typeof feedBrowseQuerySchema>;

/**
 * Counts over the walled set the viewer could see. Each facet ignores its own
 * filter (and honours the others), so a chip bar can show every category
 * while one is selected. `kind` always applies.
 */
export const feedFacetsSchema = z.object({
  categories: z.array(facetCountSchema),
  tags: z.array(facetCountSchema),
});
export type FeedFacets = z.infer<typeof feedFacetsSchema>;

export const EMPTY_FEED_FACETS: FeedFacets = { categories: [], tags: [] };

/** 13.12.c: `GET /api/search`'s query. */
export const searchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  region: regionSchema.optional(),
  kind: campaignKindSchema.optional(),
  category: contentCategorySchema.optional(),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;
