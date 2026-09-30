// 13.4.d: zod-free, so client components can import these without pulling zod.
export const CONTENT_CATEGORIES = [
  // Ordinary catalogue.
  "food-and-drink",
  "fashion",
  "personal-care",
  "electronics",
  "telco",
  "transport",
  "fitness",
  "education",
  "travel",
  "home",
  "entertainment",
  "games",
  "books",
  "family",
  "toys",
  "digital-goods",
  "services",
  // Regulated somewhere — see CATEGORY_POLICY below.
  "tobacco",
  "vaping",
  "gambling",
  "alcohol",
  "dating",
  "financial-products",
  "weight-loss",
  "cosmetic-procedures",
  "energy-drinks",
] as const;
export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];
