import {
  feedChannelResultSchema,
  feedItemSchema,
  feedResponseSchema,
  feedSurfaceSchema,
  searchResponseSchema,
} from "../feed/feed";
import type { ContractComponent } from "./schema-registry";

/** The feed-domain half of `CONTRACT_COMPONENTS` (7.7), split out for the same 300-line-ceiling reason. */
export const FEED_CONTRACT_COMPONENTS: readonly ContractComponent[] = [
  {
    id: "FeedSurface",
    schema: feedSurfaceSchema,
    description: "Which board GET /api/feed is ranking for -- home or the full-screen watch surface.",
    crossFieldRules: [],
  },
  {
    id: "FeedItem",
    schema: feedItemSchema,
    description:
      "One campaign card in the feed or search results, with the reason it was shown (`why`) and whether it is ending soon (EW-16).",
    crossFieldRules: [],
  },
  {
    id: "FeedResponse",
    schema: feedResponseSchema,
    description: "GET /api/feed's response.",
    crossFieldRules: [],
  },
  {
    id: "FeedChannelResult",
    schema: feedChannelResultSchema,
    description: "A business matched by GET /api/search.",
    crossFieldRules: [],
  },
  {
    id: "SearchResponse",
    schema: searchResponseSchema,
    description: "GET /api/search's response: campaigns, channels and listings, region- and audience-walled.",
    crossFieldRules: [],
  },
];
