import { z } from "zod";
import { idrMinorUnitsSchema, pointsSchema } from "../money/money";
import { merchantLocationSchema } from "./merchant-location";

/**
 * A listing is a store catalogue entry — a voucher or digital-goods SKU a
 * business supplies (docs/09 section 2, docs/07 section 3). The business
 * declares a settlement value; the points price is platform-computed
 * (docs/09 section 4.1) and is carried here as the already-computed value a
 * screen shows, not re-derived client-side.
 *
 * `locations` replaced a single `district: string` field (YT-0502): a
 * multi-branch merchant can hold several outlets, and which one honours a
 * given voucher is load-bearing for redemption and for disputes, not
 * cosmetic. See `merchant-location.ts`.
 */
export const listingCategorySchema = z.enum([
  "food_beverage",
  "retail",
  "digital_goods",
  "merchandise",
  "services",
]);
export type ListingCategory = z.infer<typeof listingCategorySchema>;

export const listingStatusSchema = z.enum(["available", "sold_out", "expiring_soon", "new"]);
export type ListingStatus = z.infer<typeof listingStatusSchema>;

/** Per-batch partial-redemption policy, shown to the user before spend (docs/09 section 8.2). */
export const partialRedemptionPolicySchema = z.enum([
  "balance_carrying",
  "single_use_forfeit",
  "minimum_spend",
]);
export type PartialRedemptionPolicy = z.infer<typeof partialRedemptionPolicySchema>;

const MAX_MERCHANT_NAME_LENGTH = 120;

export const listingSchema = z
  .object({
    id: z.uuid(),
    merchantId: z.uuid(),
    merchantName: z.string().min(1).max(MAX_MERCHANT_NAME_LENGTH),
    title: z.string().min(1).max(140),
    description: z.string().min(1).max(500),
    category: listingCategorySchema,
    locations: z.array(merchantLocationSchema).min(1),
    faceValueIdr: idrMinorUnitsSchema,
    settlementValueIdr: idrMinorUnitsSchema,
    priceInPoints: pointsSchema,
    stockRemaining: z.number().int().min(0),
    stockTotal: z.number().int().positive(),
    transferable: z.boolean(),
    partialRedemptionPolicy: partialRedemptionPolicySchema,
    minimumSpendIdr: idrMinorUnitsSchema.nullable(),
    expiresAt: z.iso.datetime(),
    status: listingStatusSchema,
    /**
     * The most a single wallet may redeem from this listing, or `undefined`
     * for no limit. Added for the store module's listing-management surface
     * (YT-0130/YT-0131/YT-0132 backend); `optional()` rather than
     * `.nullable().default(...)` so every existing fixture and mock that
     * predates this field keeps parsing unchanged — an omitted key is a
     * missing limit, not a validation failure.
     */
    perUserLimit: z.number().int().positive().optional(),
  })
  .refine((listing) => listing.stockRemaining <= listing.stockTotal, {
    message: "stockRemaining cannot exceed stockTotal",
    path: ["stockRemaining"],
  })
  .refine((listing) => listing.settlementValueIdr <= listing.faceValueIdr, {
    message:
      "settlementValueIdr (what the merchant is paid) cannot exceed faceValueIdr (docs/09 section 3)",
    path: ["settlementValueIdr"],
  })
  .refine((listing) => listing.status !== "sold_out" || listing.stockRemaining === 0, {
    message: "A sold_out listing must have zero stockRemaining",
    path: ["status"],
  })
  .refine(
    (listing) =>
      (listing.partialRedemptionPolicy === "minimum_spend") === (listing.minimumSpendIdr !== null),
    {
      message: "minimumSpendIdr must be set if and only if the policy is minimum_spend",
      path: ["minimumSpendIdr"],
    },
  )
  .refine(
    (listing) =>
      new Set(listing.locations.map((location) => location.id)).size === listing.locations.length,
    {
      message: "location ids must be unique within a listing",
      path: ["locations"],
    },
  );

export type Listing = z.infer<typeof listingSchema>;
