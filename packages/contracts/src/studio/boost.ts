import * as z from "zod";
import { minorUnitsSchema } from "../money/money";
import { currencySchema } from "../money/money-value";

/**
 * 13.23 (F86): a business boosts a live campaign by bidding cash for the Home
 * feed's reserved slots. Every amount is integer minor units in the
 * business's own currency, which the server takes from the business, never
 * the request. Boost is billed apart from points and never changes a
 * viewer's reward.
 */
export const boostStateSchema = z.enum(["active", "paused"]);
export type BoostState = z.infer<typeof boostStateSchema>;

const positiveMinor = minorUnitsSchema.refine((value) => value > 0, {
  message: "must be more than zero",
});

/** `PUT /api/{tenantId}/studio/campaigns/{campaignId}/boost`. */
export const setBoostRequestSchema = z
  .object({
    dailyBudgetMinor: positiveMinor,
    /** The most this campaign pays per 1,000 boosted impressions. */
    maxBidCpmMinor: positiveMinor,
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    state: boostStateSchema.default("active"),
  })
  .refine((boost) => Date.parse(boost.endsAt) > Date.parse(boost.startsAt), {
    message: "endsAt must be after startsAt",
    path: ["endsAt"],
  });
export type SetBoostRequest = z.infer<typeof setBoostRequestSchema>;

/**
 * `POST /api/{tenantId}/studio/campaigns/{campaignId}/boost/stop`: stop bidding. `now` holds the
 * boost at once; `end_of_day` lets it run to the end of today on the region's clock. Days already
 * served are still charged either way.
 */
export const stopBoostRequestSchema = z.object({ effective: z.enum(["now", "end_of_day"]) });
export type StopBoostRequest = z.infer<typeof stopBoostRequestSchema>;

/** One day's boost delivery, on the region's own clock (F16). */
export const boostDaySchema = z.object({
  day: z.iso.date(),
  impressions: z.number().int().min(0),
  /** Rounded up to a whole minor unit per day: what is charged. */
  spendMinor: z.number().int().min(0),
});

export const boostViewSchema = z.object({
  campaignId: z.uuid(),
  currency: currencySchema,
  /** `null` until the business sets a boost. */
  setting: z
    .object({
      dailyBudgetMinor: positiveMinor,
      maxBidCpmMinor: positiveMinor,
      startsAt: z.iso.datetime(),
      endsAt: z.iso.datetime(),
      state: boostStateSchema,
    })
    .nullable(),
  /** The region's floor price per 1,000 impressions. A bid below it never wins. */
  reserveCpmMinor: z.number().int().positive(),
  impressions: z.number().int().min(0),
  spendMinor: z.number().int().min(0),
  /** Average price actually paid per 1,000 impressions, or `null` with none. */
  averageCpmMinor: z.number().int().min(0).nullable(),
  days: z.array(boostDaySchema),
  /**
   * 5.1.a: boosts here charge a saved card and this business has none yet, so
   * a boost cannot be set or raised until one is added (`card_required`).
   */
  cardRequired: z.boolean(),
});
export type BoostView = z.infer<typeof boostViewSchema>;

/**
 * A day's boost spend, charged through the payment driver. Days below the
 * processor's minimum are charged together, so several days can share one
 * `providerReference`.
 */
export const boostChargeSchema = z.object({
  id: z.uuid(),
  campaignId: z.uuid(),
  campaignTitle: z.string(),
  day: z.iso.date(),
  impressions: z.number().int().min(0),
  /** What was charged for the day, GST included (F118). */
  amountMinor: positiveMinor,
  /** The ex-GST spend and its GST; null on charges from before GST was recorded. */
  subtotalMinor: minorUnitsSchema.nullable(),
  taxMinor: minorUnitsSchema.nullable(),
  currency: currencySchema,
  providerReference: z.string().min(1),
  chargedAt: z.iso.datetime(),
});
export type BoostCharge = z.infer<typeof boostChargeSchema>;

export const boostChargeListSchema = z.object({ charges: z.array(boostChargeSchema) });
export type BoostChargeList = z.infer<typeof boostChargeListSchema>;
