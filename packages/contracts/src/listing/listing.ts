import { z } from "zod";
import { contentCategorySchema } from "@yourtal/jurisdiction/content-category";
import { minorUnitsSchema, pointsSchema } from "../money/money";
import { currencySchema } from "../money/money-value";
import { regionSchema } from "../region/region";
import { audienceSchema } from "../audience/audience";
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

/**
 * Where a listing may be redeemed. TASKS.md 1.1.a — a coarser, storefront-facing
 * question than `partialRedemptionPolicy` above, which governs what happens to
 * the remainder of a partially-spent voucher.
 */
export const listingChannelSchema = z.enum(["in_store", "online", "both"]);
export type ListingChannel = z.infer<typeof listingChannelSchema>;

/**
 * TASKS.md 1.1.a's `partialRedemption`, deliberately a SECOND field alongside
 * `partialRedemptionPolicy` rather than a replacement for it.
 *
 * `partialRedemptionPolicy` already has three values, one of which
 * (`minimum_spend`) is wired through the store, wallet, merchant and burn
 * modules end to end (~49 call sites). TASKS.md's two-value list
 * (`single_use` | `balance_carries`) reads as that same policy's coarser,
 * counter-facing framing — plain language a merchant terminal shows a
 * cashier, not the billing-detail enum a settlement audit needs — so it is
 * additive here rather than a rename that would touch every one of those call
 * sites for a task whose own scope is "add these columns". A later phase
 * (7.8/8.2) can derive one from the other, or fold them together, once
 * whichever surface reads `partialRedemption` is actually built.
 */
export const partialRedemptionSchema = z.enum(["single_use", "balance_carries"]);
export type PartialRedemption = z.infer<typeof partialRedemptionSchema>;

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
  /**
   * YT-0513. ONE currency per listing, not one per amount.
   *
   * Three separate currency columns would permit a listing whose face value
   * is AUD and whose settlement value is IDR. Nothing would reject it, and
   * `B = S / priceInPoints` would silently compute across two currencies.
   * A single field makes that unrepresentable -- the argument `moneySchema`
   * makes about a transfer not mixing currencies, one level up.
   *
   * Amounts stay SCALAR minor units rather than nested `Money` objects, and
   * that is the drift test's doing rather than a preference:
   * `schema-drift.test.ts` maps each field to a snake_case column and
   * demands correspondence both ways, so a nested object would need a
   * written exemption plus two columns corresponding to nothing. Callers
   * build `money(listing.faceValueMinor, listing.currency)` at the point of
   * use, which is how the ledger tables already work.
   */
  currency: currencySchema,
  faceValueMinor: minorUnitsSchema,
  settlementValueMinor: minorUnitsSchema,
  priceInPoints: pointsSchema,
  stockRemaining: z.number().int().min(0),
  stockTotal: z.number().int().positive(),
  transferable: z.boolean(),
  partialRedemptionPolicy: partialRedemptionPolicySchema,
  minimumSpendMinor: minorUnitsSchema.nullable(),
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
  /** Immutable per business (`businessSchema.region`); every account, rate and job stays inside it (F2). */
  region: regionSchema,
  audience: audienceSchema,
  contentCategory: contentCategorySchema,
  /** The storefront card image. */
  imageUrl: z.url(),
  channel: listingChannelSchema,
  partialRedemption: partialRedemptionSchema,
});

// The invariants shared by both shapes, written once as plain predicates so
// the two refine chains below cannot drift apart.
const stockWithinTotal = (l: { stockRemaining: number; stockTotal: number }) =>
  l.stockRemaining <= l.stockTotal;
const soldOutMeansEmpty = (l: { status: string; stockRemaining: number }) =>
  l.status !== "sold_out" || l.stockRemaining === 0;
const minimumSpendMatchesPolicy = (l: {
  partialRedemptionPolicy: string;
  minimumSpendMinor: number | null;
}) => (l.partialRedemptionPolicy === "minimum_spend") === (l.minimumSpendMinor !== null);
const locationIdsUnique = (l: { locations: readonly { id: string }[] }) =>
  new Set(l.locations.map((location) => location.id)).size === l.locations.length;

/**
 * The MERCHANT-facing listing. Carries `settlementValueMinor` -- S, what the
 * merchant is paid per redemption. Never return this from a public route;
 * use `publicListingSchema`, which cannot express S at all.
 */
export const listingSchema = listingFields
  .refine(stockWithinTotal, {
    message: "stockRemaining cannot exceed stockTotal",
    path: ["stockRemaining"],
  })
  .refine((listing) => listing.settlementValueMinor <= listing.faceValueMinor, {
    message:
      "settlementValueMinor (what the merchant is paid) cannot exceed faceValueMinor (docs/09 section 3)",
    path: ["settlementValueMinor"],
  })
  .refine(soldOutMeansEmpty, {
    message: "A sold_out listing must have zero stockRemaining",
    path: ["status"],
  })
  .refine(minimumSpendMatchesPolicy, {
    message: "minimumSpendMinor must be set if and only if the policy is minimum_spend",
    path: ["minimumSpendMinor"],
  })
  .refine(locationIdsUnique, {
    message: "location ids must be unique within a listing",
    path: ["locations"],
  });

/**
 * The PUBLIC catalogue listing -- `settlementValueMinor` omitted, so the field
 * is absent from the TYPE rather than stripped at each route. Anything that
 * parses to `PublicListing` cannot carry S even by mistake, the same
 * "unrepresentable rather than excluded" move `Campaign.status` makes for
 * draft campaigns (YT-0553).
 *
 * ## Why S specifically, when faceValueMinor stays
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
 * `faceValueMinor` stays public deliberately. It is the voucher's retail
 * value, the number a shopper is entitled to compare a price against, and it
 * reveals a discount rather than what the platform holds per point.
 */
export const publicListingSchema = listingFields
  .omit({ settlementValueMinor: true })
  .refine(stockWithinTotal, {
    message: "stockRemaining cannot exceed stockTotal",
    path: ["stockRemaining"],
  })
  .refine(soldOutMeansEmpty, {
    message: "A sold_out listing must have zero stockRemaining",
    path: ["status"],
  })
  .refine(minimumSpendMatchesPolicy, {
    message: "minimumSpendMinor must be set if and only if the policy is minimum_spend",
    path: ["minimumSpendMinor"],
  })
  .refine(locationIdsUnique, {
    message: "location ids must be unique within a listing",
    path: ["locations"],
  });
export type PublicListing = z.infer<typeof publicListingSchema>;

export type Listing = z.infer<typeof listingSchema>;
