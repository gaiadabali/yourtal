/**
 * TASKS.md 9.2.d/12.4.c: restated from `@yourtal/jurisdiction`'s
 * `contentCategorySchema`/`categoryPolicy` -- that package is not an
 * `apps/web` dependency (this client-reachable module must not pull in its
 * Zod runtime), the same reason `campaign-editor-details.tsx`'s own
 * `CONTENT_CATEGORIES` restates it. The real enum/policy is still enforced
 * server-side on every approve call (`categoryRefusal`); a drift here fails
 * loudly there, not silently here.
 *
 * Despite the filename, this table is not campaign-specific -- a listing is
 * checked against the exact same region/category/audience policy
 * (`categoryRefusal`, server-side), so `staff-listing-approve-dialog-button.tsx`
 * imports this module too rather than duplicating the table a third time.
 */
export const CONTENT_CATEGORIES = [
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

export const AUDIENCES = ["all_ages", "teen", "adult", "parents"] as const;
export type Audience = (typeof AUDIENCES)[number];

export type CategoryStatus = "allowed" | "adult_only" | "prohibited";
type Region = "AU" | "ID";

/** `packages/jurisdiction/src/content-category.ts`'s own table, TASKS.md 1.1.d exactly. */
const CATEGORY_POLICY: Readonly<
  Record<Region, Readonly<Partial<Record<ContentCategory, CategoryStatus>>>>
> = {
  AU: {
    tobacco: "prohibited",
    vaping: "prohibited",
    gambling: "adult_only",
    alcohol: "adult_only",
    dating: "adult_only",
    "financial-products": "adult_only",
    "weight-loss": "adult_only",
    "cosmetic-procedures": "adult_only",
    "energy-drinks": "adult_only",
  },
  ID: {
    gambling: "prohibited",
    tobacco: "prohibited",
    vaping: "prohibited",
    alcohol: "adult_only",
    dating: "adult_only",
    "financial-products": "adult_only",
    "weight-loss": "adult_only",
    "cosmetic-procedures": "adult_only",
    "energy-drinks": "adult_only",
  },
};

export function categoryPolicy(region: Region, category: ContentCategory): CategoryStatus {
  return CATEGORY_POLICY[region][category] ?? "allowed";
}

/** Every category the 1.1.d policy allows to be SAVED for this region -- excludes only `prohibited`; `adult_only` stays selectable (it constrains audience instead, see below). */
export function allowedCategoriesFor(region: Region): readonly ContentCategory[] {
  return CONTENT_CATEGORIES.filter((category) => categoryPolicy(region, category) !== "prohibited");
}

/** Every audience legal for this category in this region -- `adult_only` forces `adult`, the same rule `category-policy.ts`'s server-side `categoryRefusal` enforces. */
export function allowedAudiencesFor(
  region: Region,
  category: ContentCategory,
): readonly Audience[] {
  return categoryPolicy(region, category) === "adult_only" ? ["adult"] : AUDIENCES;
}
