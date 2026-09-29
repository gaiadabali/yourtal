import { z } from "zod";
import { minorUnitsSchema, pointsSchema } from "../money/money";
import { currencySchema } from "../money/money-value";
import { regionSchema } from "../region/region";

/**
 * 7.5: Studio billing — buying points. `P_issue` (the pack price) appears
 * only here, never on a consumer surface (F12) -- the same reasoning
 * `ledger-internal/pricing.ts`'s `quoteRequestSchema` gives for never
 * carrying `B`. This module's own shapes, distinct from `ledger-internal`'s:
 * that folder is the apps/api <-> ledger contract; this one is the BFF <->
 * Studio contract, and the two are allowed to diverge (e.g. no
 * `backingRateId`, no `demandMultiplierBps` -- neither is Studio's business).
 */

export const purchaseQuoteSchema = z.object({
  points: pointsSchema,
  totalMinor: minorUnitsSchema,
  currency: currencySchema,
});
export type PurchaseQuote = z.infer<typeof purchaseQuoteSchema>;

/**
 * `currency` is REQUIRED, never defaulted (TASKS.md 7.5.a: "no IDR
 * default") -- the caller states what it expects to be charged in, and the
 * use-case refuses a mismatch against the business's own currency rather
 * than silently charging in the wrong one.
 */
export const purchasePointsRequestSchema = z.object({
  points: pointsSchema,
  currency: currencySchema,
});
export type PurchasePointsRequest = z.infer<typeof purchasePointsRequestSchema>;

export const funderTypeSchema = z.enum(["partner", "marketing"]);

export const billingAllocationSchema = z.object({
  allocationId: z.string().min(1),
  region: regionSchema,
  funderType: funderTypeSchema,
  totalPoints: pointsSchema,
  remainingPoints: pointsSchema,
  createdAt: z.iso.datetime(),
});
export type BillingAllocation = z.infer<typeof billingAllocationSchema>;

export const purchaseResultSchema = z.object({
  allocation: billingAllocationSchema,
  paidMinor: minorUnitsSchema,
  currency: currencySchema,
  /** The simulated payments driver's own reference (`ChargeAccepted.providerReference`). */
  providerReference: z.string().min(1),
});
export type PurchaseResult = z.infer<typeof purchaseResultSchema>;

/**
 * `remainingPoints` is already "remaining minus active holds" (TASKS.md
 * 7.5.b) -- a hold decrements `ledger.allocation.remaining_points` directly
 * at the moment it is placed (`platform.ledger_fake_hold`/its live
 * counterpart), so there is no separate number to compute.
 */
export const billingBalanceSchema = z.object({
  totalPoints: pointsSchema,
  remainingPoints: pointsSchema,
  allocations: z.array(billingAllocationSchema),
});
export type BillingBalance = z.infer<typeof billingBalanceSchema>;

export const billingCampaignSpendSchema = z.object({
  campaignId: z.uuid(),
  grantedPoints: pointsSchema,
  completions: z.number().int().min(0),
});
export type BillingCampaignSpend = z.infer<typeof billingCampaignSpendSchema>;

/**
 * 10.1.b/10.6.b: the Studio-facing view of a weekly settlement statement --
 * the same figures `ledger-internal/economy.ts`'s `Statement` carries, under
 * this module's own name (this folder is the BFF <-> Studio contract,
 * distinct from ledger-internal's apps/api <-> ledger one, same reasoning
 * as this file's own module comment above).
 */
export const billingStatementSchema = z.object({
  id: z.string().min(1),
  region: regionSchema,
  currency: currencySchema,
  periodFrom: z.iso.datetime(),
  periodTo: z.iso.datetime(),
  openingPayableMinor: z.number().int(),
  capturesMinor: minorUnitsSchema,
  refundsMinor: minorUnitsSchema,
  recoveriesMinor: minorUnitsSchema,
  closingPayableMinor: z.number().int(),
  pointPurchasesPoints: pointsSchema,
  status: z.enum(["open", "disputed", "paid"]),
  disputeReason: z.string().nullable(),
  disputeWindowEndsAt: z.iso.datetime(),
  generatedAt: z.iso.datetime(),
  payoutTransferId: z.string().nullable(),
});
export type BillingStatement = z.infer<typeof billingStatementSchema>;

/** 10.6.b: holds the payout until staff resolve it in the staff console's queue (10.6.a/10.5.a). */
export const raiseStatementDisputeRequestSchema = z.object({
  reason: z.string().min(1),
});
export type RaiseStatementDisputeRequest = z.infer<typeof raiseStatementDisputeRequestSchema>;
