import { z } from "zod";
import { minorUnitsSchema, pointsSchema } from "../money/money";
import { currencySchema } from "../money/money-value";
import { regionSchema } from "../region/region";

/** TASKS.md 1.2.a's economy group. */

export const coverageSchema = z.object({
  region: regionSchema,
  /** Reserve cash divided by points outstanding, both in the region's currency. K6. */
  ratio: z.number().min(0),
  reserveMinor: minorUnitsSchema,
  pointsOutstanding: pointsSchema,
  asOf: z.iso.datetime(),
  /** Nothing is owed at all, which is not a ratio; `ratio` is 0 then. */
  nothingOwed: z.boolean().default(false),
});
export type Coverage = z.infer<typeof coverageSchema>;

export const economyDailyRequestSchema = z.object({
  region: regionSchema,
  from: z.iso.date(),
  to: z.iso.date(),
});
export type EconomyDailyRequest = z.infer<typeof economyDailyRequestSchema>;

export const economyDayRowSchema = z.object({
  date: z.iso.date(),
  region: regionSchema,
  pointsIssued: pointsSchema,
  pointsRedeemed: pointsSchema,
  reserveMinor: minorUnitsSchema,
});
export type EconomyDayRow = z.infer<typeof economyDayRowSchema>;

export const proposeRateRequestSchema = z.object({
  region: regionSchema,
  currency: currencySchema,
  backingRateMicrosPerPoint: z.number().int().positive(),
  proposedBy: z.string().min(1),
});
export type ProposeRateRequest = z.infer<typeof proposeRateRequestSchema>;

export const rateProposalSchema = z.object({
  proposalId: z.string().min(1),
  region: regionSchema,
  backingRateMicrosPerPoint: z.number().int().positive(),
  proposedBy: z.string().min(1),
  approvedBy: z.string().min(1).nullable(),
  state: z.enum(["pending", "approved"]),
});
export type RateProposal = z.infer<typeof rateProposalSchema>;

/** Two-person approval (9.5): `approvedBy` must differ from `proposedBy`. */
export const approveRateRequestSchema = z.object({
  proposalId: z.string().min(1),
  approvedBy: z.string().min(1),
});
export type ApproveRateRequest = z.infer<typeof approveRateRequestSchema>;

export const fundMarketingRequestSchema = z.object({
  region: regionSchema,
  amountMinor: minorUnitsSchema,
  proposedBy: z.string().min(1),
  approvedBy: z.string().min(1),
});
export type FundMarketingRequest = z.infer<typeof fundMarketingRequestSchema>;

/** `statements` and `approvePayout` return `not_implemented` until 10.1 — declared for callers to depend on the shape now. */
export const statementsRequestSchema = z.object({
  businessId: z.uuid(),
  from: z.iso.date(),
  to: z.iso.date(),
});
export type StatementsRequest = z.infer<typeof statementsRequestSchema>;

export const approvePayoutRequestSchema = z.object({
  statementId: z.string().min(1),
  approvedBy: z.string().min(1),
});
export type ApprovePayoutRequest = z.infer<typeof approvePayoutRequestSchema>;
