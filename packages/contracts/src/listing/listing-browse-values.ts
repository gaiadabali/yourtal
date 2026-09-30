// 13.4.d: zod-free, so client components can import these without pulling zod.
export const LISTING_SORTS = [
  "popular",
  "newest",
  "points_asc",
  "points_desc",
  "ending_soon",
] as const;
export type ListingSort = (typeof LISTING_SORTS)[number];
