import { z } from "zod";
import type { JurisdictionCode } from "./jurisdiction-code";

/**
 * The category a campaign or listing advertises, and what each jurisdiction
 * allows it to do — TASKS.md 1.1.d, one source both regions' catalogues read.
 *
 * The values are the ordinary catalogue below, plus the categories that are
 * regulated somewhere. Keeping the regulated ones in the SAME enum as the
 * ordinary ones means a listing cannot be authored with a category this
 * package has never heard of; a separate "restricted categories" enum would
 * let a typo'd category silently fall through `categoryPolicy`'s `allowed`
 * default instead of being rejected by the schema.
 */
export const contentCategorySchema = z.enum([
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
]);
export type ContentCategory = z.infer<typeof contentCategorySchema>;

export const categoryStatusSchema = z.enum(["allowed", "adult_only", "prohibited"]);
export type CategoryStatus = z.infer<typeof categoryStatusSchema>;

/**
 * Per TASKS.md 1.1.d exactly:
 * - AU prohibited: tobacco, vaping.
 * - ID prohibited: gambling, tobacco, vaping.
 * - adult_only in both regions: alcohol, dating, financial products, weight
 *   loss, cosmetic procedures, energy drinks, plus gambling in AU.
 *
 * A category with no entry here is `allowed` — see `categoryPolicy`'s
 * default — which is why the ordinary catalogue above needs no rows at all.
 */
const CATEGORY_POLICY: Readonly<
  Record<JurisdictionCode, Readonly<Partial<Record<ContentCategory, CategoryStatus>>>>
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

/** `categoryPolicy[region][contentCategory]` from TASKS.md 1.1.d, as a function rather than a raw table lookup so an unlisted category reads `allowed` rather than `undefined`. */
export function categoryPolicy(
  jurisdiction: JurisdictionCode,
  category: ContentCategory,
): CategoryStatus {
  return CATEGORY_POLICY[jurisdiction][category] ?? "allowed";
}
