import { z } from "zod";
import { packageTierKeySchema } from "@yourtal/contracts/billing/package-tiers";

/** 14.13: a quote names a package, never a number of points (F121). */
export const quotePurchaseQuerySchema = z.object({
  tier: packageTierKeySchema,
});

export type QuotePurchaseQuery = z.infer<typeof quotePurchaseQuerySchema>;
