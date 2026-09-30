// 13.4.d: zod-free, so client components can import these without pulling zod.
export const FEED_SORTS = ["for_you", "newest", "most_points", "ending_soon"] as const;
export type FeedSort = (typeof FEED_SORTS)[number];
