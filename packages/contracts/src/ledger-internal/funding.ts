import { z } from "zod";
import { minorUnitsSchema, pointsSchema } from "../money/money";
import { currencySchema } from "../money/money-value";
import { regionSchema } from "../region/region";

/** TASKS.md 1.2.a's funding-and-allocations group. */

export const funderTypeSchema = z.enum(["partner", "marketing"]);
export type FunderType = z.infer<typeof funderTypeSchema>;

export const purchasePointsRequestSchema = z.object({
  businessId: z.uuid(),
  region: regionSchema,
  currency: currencySchema,
  points: pointsSchema,
  paidMinor: minorUnitsSchema,
  idempotencyKey: z.string().min(1),
});
export type PurchasePointsRequest = z.infer<typeof purchasePointsRequestSchema>;

export const allocationSchema = z.object({
  allocationId: z.string().min(1),
  businessId: z.uuid(),
  region: regionSchema,
  funderType: funderTypeSchema,
  totalPoints: pointsSchema,
  remainingPoints: pointsSchema,
  createdAt: z.iso.datetime(),
});
export type Allocation = z.infer<typeof allocationSchema>;

export const holdRequestSchema = z.object({
  allocationId: z.string().min(1),
  points: pointsSchema,
  sagaId: z.string().min(1),
  /** How long the session may run: 2 x the video's duration + 1 h (4.4.e). Default 3 h. */
  ttlSeconds: z.number().int().positive().optional(),
});
export type HoldRequest = z.infer<typeof holdRequestSchema>;

export const holdSchema = z.object({
  holdId: z.string().min(1),
  allocationId: z.string().min(1),
  points: pointsSchema,
  sagaId: z.string().min(1),
  state: z.enum(["held", "consumed", "released"]),
});
export type Hold = z.infer<typeof holdSchema>;

export const returnGrantRequestSchema = z.object({ grantId: z.string().min(1) });
export type ReturnGrantRequest = z.infer<typeof returnGrantRequestSchema>;

export const campaignSpendSchema = z.object({
  campaignId: z.uuid(),
  allocationId: z.string().min(1),
  grantedPoints: pointsSchema,
  completions: z.number().int().min(0),
});
export type CampaignSpend = z.infer<typeof campaignSpendSchema>;
