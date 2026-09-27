import { z } from "zod";
import { feedSurfaceSchema } from "@yourtal/contracts/feed";
import { regionSchema } from "@yourtal/contracts/region";

/**
 * `region` is OPTIONAL here for the same reason `browse-listings-query.ts`
 * leaves it optional (7.4.d, F2): a signed-in caller's region comes from
 * their own principal, never the query string. Only an anonymous caller's
 * required "path region" is ever read from this field --
 * `get-feed.use-case.ts`/`catalogue-scope.ts` decide which case applies.
 */
export const feedQuerySchema = z.object({
  surface: feedSurfaceSchema.default("home"),
  region: regionSchema.optional(),
});

export type FeedQuery = z.infer<typeof feedQuerySchema>;
