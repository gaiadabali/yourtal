// 13.4.d: zod-free, so client components can import these without pulling zod.
export const LISTING_SORTS = [
  "popular",
  "newest",
  "points_asc",
  "points_desc",
  "ending_soon",
] as const;
/** 13.12.e: "where to use it"; each also matches a listing good for `both`. */
export const LISTING_WHERE = ["in_store", "online"] as const;
export type ListingWhere = (typeof LISTING_WHERE)[number];

export type ListingSort = (typeof LISTING_SORTS)[number];
