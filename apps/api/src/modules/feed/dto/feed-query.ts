import { feedBrowseQuerySchema } from "@yourtal/contracts/feed";
import type { FeedBrowseQuery } from "@yourtal/contracts/feed";

/**
 * 13.12.a: the contract's browse query. `region` stays optional: a signed-in
 * caller's region comes from their principal, never the query string
 * (`get-feed.use-case.ts`/`catalogue-scope.ts` decide which case applies).
 */
export const feedQuerySchema = feedBrowseQuerySchema;
export type FeedQuery = FeedBrowseQuery;
