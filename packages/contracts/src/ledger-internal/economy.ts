import * as z from "zod";
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

/** 10.1: `statements` lists what apps/worker's weekly job has already generated — it never generates. */
export const statementsRequestSchema = z.object({
  businessId: z.uuid(),
  from: z.iso.date(),
  to: z.iso.date(),
});
export type StatementsRequest = z.infer<typeof statementsRequestSchema>;

/**
 * 10.1.b's weekly statement: opening payable + captures − refunds − K13
 * recoveries = closingPayableMinor (the amount payable). Point purchases are
 * informational only (J1), never folded into the figures above.
 *
 * opening/closingPayableMinor are plain signed integers, not `minorUnitsSchema`
 * — an over-recovery (rare, and only ever a temporary state until the next
 * statement) can in principle leave a balance below zero, and a UI must be
 * able to show that rather than fail to parse it.
 */
export const statementSchema = z.object({
  id: z.string().min(1),
  businessId: z.uuid(),
  region: regionSchema,
  currency: currencySchema,
  periodFrom: z.iso.datetime(),
  periodTo: z.iso.datetime(),
  openingPayableMinor: z.number().int(),
  capturesMinor: minorUnitsSchema,
  refundsMinor: minorUnitsSchema,
  recoveriesMinor: minorUnitsSchema,
  closingPayableMinor: z.number().int(),
  pointPurchasesMinor: minorUnitsSchema,
  pointPurchasesPoints: pointsSchema,
  status: z.enum(["open", "disputed", "paid"]),
  disputeReason: z.string().nullable(),
  disputedAt: z.iso.datetime().nullable(),
  resolutionNote: z.string().nullable(),
  resolvedAt: z.iso.datetime().nullable(),
  disputeWindowEndsAt: z.iso.datetime(),
  generatedAt: z.iso.datetime(),
  approvedBy: z.string().nullable(),
  approvedAt: z.iso.datetime().nullable(),
  payoutTransferId: z.string().nullable(),
});
export type Statement = z.infer<typeof statementSchema>;

/** apps/worker-only (10.1.b): the one caller that knows a business's region without inferring it. */
export const generateStatementRequestSchema = z.object({
  businessId: z.uuid(),
  region: regionSchema,
  from: z.iso.date(),
  to: z.iso.date(),
});
export type GenerateStatementRequest = z.infer<typeof generateStatementRequestSchema>;

/** 10.6.b: the studio's own dispute — holds the payout until staff resolve it (10.6.a). */
export const disputeStatementRequestSchema = z.object({
  statementId: z.string().min(1),
  reason: z.string().min(1),
});
export type DisputeStatementRequest = z.infer<typeof disputeStatementRequestSchema>;

/** 10.5.a: staff releases a disputed statement back to `open`. */
export const resolveStatementDisputeRequestSchema = z.object({
  statementId: z.string().min(1),
  note: z.string().min(1),
});
export type ResolveStatementDisputeRequest = z.infer<typeof resolveStatementDisputeRequestSchema>;

export const approvePayoutRequestSchema = z.object({
  statementId: z.string().min(1),
  approvedBy: z.string().min(1),
});
export type ApprovePayoutRequest = z.infer<typeof approvePayoutRequestSchema>;

/**
 * 10.1.c/10.2.b: an expired voucher or a forfeited remainder never captured
 * releases its own settlement value back — no merchant was ever paid, so
 * there is no payable leg. The caller owns idempotencyKey (one per
 * voucher/event), so a retried sweep cannot release the same liability twice.
 */
export const releaseVoucherLiabilityRequestSchema = z.object({
  idempotencyKey: z.string().min(1),
  region: regionSchema,
  amountMinor: minorUnitsSchema,
});
export type ReleaseVoucherLiabilityRequest = z.infer<typeof releaseVoucherLiabilityRequestSchema>;
