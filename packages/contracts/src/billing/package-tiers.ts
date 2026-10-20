import * as z from "zod";

/**
 * 14.13 (F121/F122): the `point_package_tiers` region setting -- each
 * region's point packages, a size and a discount off P_issue. Validated here
 * when staff propose or approve it, and again by the ledger, which also
 * refuses any tier priced below B (K6) and is the only one that can check it.
 * The rules match `services/ledger/internal/pricing/tiers.go`.
 */
export const PACKAGE_TIERS_SETTING_KEY = "point_package_tiers";

/** The ledger sells points in packs of 1,000 (F12). */
export const PACK_POINTS = 1_000;
export const MAX_TIER_DISCOUNT_BPS = 5_000;

export const packageTierKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/);
export type PackageTierKey = z.infer<typeof packageTierKeySchema>;

export const packageTierSchema = z.strictObject({
  key: packageTierKeySchema,
  points: z.number().int().positive().max(100_000_000).multipleOf(PACK_POINTS),
  discountBps: z.number().int().min(0).max(MAX_TIER_DISCOUNT_BPS),
});
export type PackageTier = z.infer<typeof packageTierSchema>;

export const packageTierCatalogueSchema = z
  .array(packageTierSchema)
  .min(1)
  .max(10)
  .refine((tiers) => new Set(tiers.map((tier) => tier.key)).size === tiers.length, {
    message: "tier keys must be unique",
  });
export type PackageTierCatalogue = z.infer<typeof packageTierCatalogueSchema>;
