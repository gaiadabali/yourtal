// 13.4.d: zod-free, so client components can import these without pulling zod.
export const LISTING_CATEGORIES = [
  "food_beverage",
  "retail",
  "digital_goods",
  "merchandise",
  "services",
] as const;
export type ListingCategory = (typeof LISTING_CATEGORIES)[number];

export const LISTING_CHANNELS = ["in_store", "online", "both"] as const;
export type ListingChannel = (typeof LISTING_CHANNELS)[number];
