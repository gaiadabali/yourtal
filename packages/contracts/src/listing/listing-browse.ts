import { z } from "zod";
import { regionSchema } from "../region/region";
import {
  MAX_TAGS,
  csvListParam,
  facetCountSchema,
  interestTagSchema,
} from "../interest/interest-tags";
import { listingCategorySchema, publicListingSchema } from "./listing";

/**
 * 13.12.b: `GET /api/store/listings`'s query. Filtering, sorting and facet
 * counts all run on the server inside the region and audience walls; the
 * store no longer filters in the browser over one fetch.
 */
export const listingSortSchema = z.enum([
  "popular",
  "newest",
  "points_asc",
  "points_desc",
  "ending_soon",
]);
export type ListingSort = z.infer<typeof listingSortSchema>;

export const LISTING_BROWSE_DEFAULT_LIMIT = 20;
export const LISTING_BROWSE_MAX_LIMIT = 100;
const MAX_BRANDS = 20;

export const listingBrowseQuerySchema = z.object({
  /** Only read for an anonymous caller; a signed-in caller's region is their own. */
  region: regionSchema.optional(),
  category: listingCategorySchema.optional(),
  /** A single merchant, e.g. a brand page. */
  merchantId: z.uuid().optional(),
  /** Any of these merchants (the brand filter); combines with `merchantId` by AND. */
  brand: csvListParam(z.uuid(), MAX_BRANDS),
  /** Matches a listing carrying ANY of these tags. */
  tags: csvListParam(interestTagSchema, MAX_TAGS),
  district: z.string().min(1).max(60).optional(),
  q: z.string().min(1).max(200).optional(),
  minPoints: z.coerce.number().int().min(0).optional(),
  maxPoints: z.coerce.number().int().min(0).optional(),
  sort: listingSortSchema.default("popular"),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(LISTING_BROWSE_MAX_LIMIT)
    .default(LISTING_BROWSE_DEFAULT_LIMIT),
  /** Cursor: the last listing id of the previous page, in the same sort. */
  startingAfter: z.uuid().optional(),
});
export type ListingBrowseQuery = z.infer<typeof listingBrowseQuerySchema>;

export const brandFacetSchema = facetCountSchema.extend({
  /** The merchant's display name, for the filter label. `value` is its id. */
  label: z.string().min(1),
});
export type BrandFacet = z.infer<typeof brandFacetSchema>;

/**
 * Counts over the walled, active set. Each facet ignores its own filter and
 * honours the others, so the sidebar can show every option while one is set.
 */
export const listingFacetsSchema = z.object({
  categories: z.array(facetCountSchema),
  tags: z.array(facetCountSchema),
  brands: z.array(brandFacetSchema),
});
export type ListingFacets = z.infer<typeof listingFacetsSchema>;

export const EMPTY_LISTING_FACETS: ListingFacets = { categories: [], tags: [], brands: [] };

export const listingBrowseResponseSchema = z.object({
  object: z.literal("list"),
  data: z.array(publicListingSchema),
  has_more: z.boolean(),
  url: z.literal("/api/store/listings"),
  /** Every row matching the filters, across all pages: the "N results" line. */
  total_count: z.number().int().min(0).default(0),
  facets: listingFacetsSchema.default(EMPTY_LISTING_FACETS),
});
export type ListingBrowseResponse = z.infer<typeof listingBrowseResponseSchema>;
