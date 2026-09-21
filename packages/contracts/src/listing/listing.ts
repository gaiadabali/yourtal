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

/**
 * The raw field set, named so the public shape can be derived by OMISSION
 * rather than re-listed. A second hand-written field list is a second thing
 * to forget when a field is added -- and the field you forget to withhold is
 * the one that leaks.
 */
const listingFields = z.object({
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
});

// The invariants shared by both shapes, written once as plain predicates so
// the two refine chains below cannot drift apart.
const stockWithinTotal = (l: { stockRemaining: number; stockTotal: number }) =>
  l.stockRemaining <= l.stockTotal;
const soldOutMeansEmpty = (l: { status: string; stockRemaining: number }) =>
  l.status !== "sold_out" || l.stockRemaining === 0;
const minimumSpendMatchesPolicy = (l: {
  partialRedemptionPolicy: string;
  minimumSpendIdr: number | null;
}) => (l.partialRedemptionPolicy === "minimum_spend") === (l.minimumSpendIdr !== null);
const locationIdsUnique = (l: { locations: readonly { id: string }[] }) =>
  new Set(l.locations.map((location) => location.id)).size === l.locations.length;

/**
 * The MERCHANT-facing listing. Carries `settlementValueIdr` -- S, what the
 * merchant is paid per redemption. Never return this from a public route;
 * use `publicListingSchema`, which cannot express S at all.
 */
export const listingSchema = listingFields
  .refine(stockWithinTotal, {
    message: "stockRemaining cannot exceed stockTotal",
    path: ["stockRemaining"],
  })
  .refine((listing) => listing.settlementValueIdr <= listing.faceValueIdr, {
    message:
      "settlementValueIdr (what the merchant is paid) cannot exceed faceValueIdr (docs/09 section 3)",
    path: ["settlementValueIdr"],
  })
  .refine(soldOutMeansEmpty, {
    message: "A sold_out listing must have zero stockRemaining",
    path: ["status"],
  })
  .refine(minimumSpendMatchesPolicy, {
    message: "minimumSpendIdr must be set if and only if the policy is minimum_spend",
    path: ["minimumSpendIdr"],
  })
  .refine(locationIdsUnique, {
    message: "location ids must be unique within a listing",
    path: ["locations"],
  });

/**
 * The PUBLIC catalogue listing -- `settlementValueIdr` omitted, so the field
 * is absent from the TYPE rather than stripped at each route. Anything that
 * parses to `PublicListing` cannot carry S even by mistake, the same
 * "unrepresentable rather than excluded" move `Campaign.status` makes for
 * draft campaigns (YT-0553).
 *
 * ## Why S specifically, when faceValueIdr stays
 *
 * docs/24 ID-1 is named there as the single largest legal exposure in the
 * plan: YourTal Points are a loyalty currency rather than e-money BECAUSE,
 * among four things, there is **no published fixed cash rate**.
 *
 * `priceInPoints` must be public -- it is what the user pays. Publishing S
 * beside it publishes the backing rate by arithmetic:
 * `points_price = (S / B) x demand_multiplier`, and the multiplier is pinned
 * at 1.0 for launch (YT-0130), so `B = S / priceInPoints` exactly. One row
 * is enough; this needs no aggregation and is not an approximation.
 *
 * `faceValueIdr` stays public deliberately. It is the voucher's retail
 * value, the number a shopper is entitled to compare a price against, and it
 * reveals a discount rather than what the platform holds per point.
 */
export const publicListingSchema = listingFields
  .omit({ settlementValueIdr: true })
  .refine(stockWithinTotal, {
    message: "stockRemaining cannot exceed stockTotal",
    path: ["stockRemaining"],
  })
  .refine(soldOutMeansEmpty, {
    message: "A sold_out listing must have zero stockRemaining",
    path: ["status"],
  })
  .refine(minimumSpendMatchesPolicy, {
    message: "minimumSpendIdr must be set if and only if the policy is minimum_spend",
    path: ["minimumSpendIdr"],
  })
  .refine(locationIdsUnique, {
    message: "location ids must be unique within a listing",
    path: ["locations"],
  });
export type PublicListing = z.infer<typeof publicListingSchema>;

export type Listing = z.infer<typeof listingSchema>;
