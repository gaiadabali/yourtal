import { facetCountSchema, interestTagSchema, interestTagsSchema } from "../interest/interest-tags";
import { feedFacetsSchema, feedSortSchema } from "../feed/feed-browse";
import {
  brandFacetSchema,
  listingBrowseResponseSchema,
  listingFacetsSchema,
  listingSortSchema,
} from "../listing/listing-browse";
import type { ContractComponent } from "./schema-registry";

/** 13.11/13.12: tags, browse sorts and facets, split out for the 300-line ceiling. */
export const BROWSE_CONTRACT_COMPONENTS: readonly ContractComponent[] = [
  {
    id: "InterestTag",
    schema: interestTagSchema,
    description: "One tag: an interest-taxonomy node id, never free text (F84).",
    crossFieldRules: [],
  },
  {
    id: "InterestTags",
    schema: interestTagsSchema,
    description: "Up to 8 unique interest tags on a campaign or listing (13.11).",
    crossFieldRules: [],
  },
  {
    id: "FacetCount",
    schema: facetCountSchema,
    description: "A facet bucket: a value present in the walled result set and its row count.",
    crossFieldRules: [],
  },
  {
    id: "FeedSort",
    schema: feedSortSchema,
    description: "GET /api/feed's `sort`: the personalised ranking or a plain ordering.",
    crossFieldRules: [],
  },
  {
    id: "FeedFacets",
    schema: feedFacetsSchema,
    description:
      "Category and tag counts over the feed's walled set; each facet ignores its own filter.",
    crossFieldRules: [],
  },
  {
    id: "ListingSort",
    schema: listingSortSchema,
    description: "GET /api/store/listings's `sort`.",
    crossFieldRules: [],
  },
  {
    id: "BrandFacet",
    schema: brandFacetSchema,
    description: "A brand filter option: the merchant id, its name and its listing count.",
    crossFieldRules: [],
  },
  {
    id: "ListingFacets",
    schema: listingFacetsSchema,
    description:
      "Category, tag and brand counts over the store's walled set; each facet ignores its own filter.",
    crossFieldRules: [],
  },
  {
    id: "ListingBrowseResponse",
    schema: listingBrowseResponseSchema,
    description:
      "GET /api/store/listings's response: one page, the total match count and the facets (13.12.b).",
    crossFieldRules: [],
  },
];
