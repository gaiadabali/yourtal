import * as z from "zod";
import { minorUnitsSchema, pointsSchema } from "../money/money";
import { currencySchema } from "../money/money-value";
import { regionSchema } from "../region/region";
import { packageTierKeySchema } from "./package-tiers";

/**
 * 7.5: Studio billing — buying points. `P_issue` (the pack price) appears
 * only here, never on a consumer surface (F12) -- the same reasoning
 * `ledger-internal/pricing.ts`'s `quoteRequestSchema` gives for never
 * carrying `B`. This module's own shapes, distinct from `ledger-internal`'s:
 * that folder is the apps/api <-> ledger contract; this one is the BFF <->
 * Studio contract, and the two are allowed to diverge (e.g. no
 * `backingRateId`, no `demandMultiplierBps` -- neither is Studio's business).
 */

/** Basis points (1000 = 10%). F118: AU adds GST on top of an ex-GST price; Indonesia adds none. */
const taxRateBpsSchema = z.number().int().min(0).max(10_000);

/**
 * 14.13 (F121/F122): one point package as Studio sells it. F118: the price is
 * ex-GST (`subtotalMinor`); `totalMinor` = subtotal + GST is what the card is
 * charged. `pricePer1000Minor` (ex-GST, rounded up) and `savingMinor` (ex-GST,
 * against the same points at the undiscounted rate) are for display; the
 * ledger prices the package again when the payment lands.
 */
export const pointPackageSchema = z.object({
  tierKey: packageTierKeySchema,
  points: pointsSchema,
  discountBps: z.number().int().min(0).max(10_000),
  subtotalMinor: minorUnitsSchema,
  taxMinor: minorUnitsSchema,
  totalMinor: minorUnitsSchema,
  taxRateBps: taxRateBpsSchema,
  currency: currencySchema,
  pricePer1000Minor: minorUnitsSchema,
  savingMinor: minorUnitsSchema,
});
export type PointPackage = z.infer<typeof pointPackageSchema>;

/** `GET .../billing/packages`: every package on sale in the business's region, smallest first. */
export const pointPackagesSchema = z.object({ packages: z.array(pointPackageSchema) });
export type PointPackages = z.infer<typeof pointPackagesSchema>;

/** `GET .../billing/purchases/quote?tier=`: one package, priced now. */
export const purchaseQuoteSchema = pointPackageSchema;
export type PurchaseQuote = PointPackage;

/**
 * F121: a business buys a package, never an arbitrary number of points.
 * `currency` is REQUIRED, never defaulted (TASKS.md 7.5.a: "no IDR
 * default") -- the caller states what it expects to be charged in, and the
 * use-case refuses a mismatch against the business's own currency rather
 * than silently charging in the wrong one.
 */
export const purchasePointsRequestSchema = z.object({
  tierKey: packageTierKeySchema,
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

/**
 * 5.1.a: a card purchase of points. `pending` until the processor's verified
 * webhook says it was paid; `needs_review` is money received that staff must
 * settle (the rate rose while the checkout was open). F107: no refunds here.
 */
export const cardPurchaseStatusSchema = z.enum(["pending", "paid", "expired", "needs_review"]);
export type CardPurchaseStatus = z.infer<typeof cardPurchaseStatusSchema>;

export const cardPurchaseSchema = z.object({
  purchaseId: z.uuid(),
  status: cardPurchaseStatusSchema,
  /** The package bought; null for a purchase made before packages. */
  tierKey: packageTierKeySchema.nullable(),
  points: pointsSchema,
  subtotalMinor: minorUnitsSchema,
  taxMinor: minorUnitsSchema,
  totalMinor: minorUnitsSchema,
  taxRateBps: taxRateBpsSchema,
  currency: currencySchema,
  /** Set once the points are granted. */
  allocationId: z.string().min(1).nullable(),
  createdAt: z.iso.datetime(),
  paidAt: z.iso.datetime().nullable(),
});
export type CardPurchase = z.infer<typeof cardPurchaseSchema>;

/**
 * `POST .../billing/purchases`. `awaiting_payment`: send the browser to
 * `checkoutUrl`; the points arrive with the webhook. `paid` (a processor that
 * settles at once): `allocation` holds the points already. A replay of an
 * older key can answer `needs_review` or `expired`.
 */
export const purchaseResultSchema = z.object({
  status: z.enum(["awaiting_payment", "paid", "needs_review", "expired"]),
  purchaseId: z.uuid(),
  checkoutUrl: z.url().nullable(),
  purchase: cardPurchaseSchema,
  allocation: billingAllocationSchema.nullable(),
});
export type PurchaseResult = z.infer<typeof purchaseResultSchema>;

/** A saved card as Studio shows it: never more than brand, last four digits and expiry. */
export const savedCardSchema = z.object({
  brand: z.string().min(1),
  last4: z.string().regex(/^[0-9]{4}$/),
  expMonth: z.number().int().min(1).max(12),
  expYear: z.number().int().min(2000).max(2100),
});
export type SavedCardView = z.infer<typeof savedCardSchema>;

/** `GET .../billing/card`. `required`: boosts in this region charge a saved card (Stripe). */
export const billingCardSchema = z.object({
  card: savedCardSchema.nullable(),
  required: z.boolean(),
});
export type BillingCard = z.infer<typeof billingCardSchema>;

/** `POST .../billing/card`: a page to save the card on, or the card itself when it is saved at once. */
export const startCardSetupResultSchema = z.object({
  checkoutUrl: z.url().nullable(),
  card: savedCardSchema.nullable(),
});
export type StartCardSetupResult = z.infer<typeof startCardSetupResultSchema>;

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

/**
 * 14.13.b (F121): an alert that a package (an allocation the business bought)
 * or a campaign's total budget has reached 50%, 80% or 100% used. Each is
 * raised once and also emailed to the business's owner and finance members.
 * At 100% rewards stop: the ledger refuses to hold points it does not have.
 */
export const budgetAlertSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["package", "campaign"]),
  /** The allocation id for a package, the campaign id for a campaign. */
  subjectId: z.string().min(1),
  /** The campaign's title; null for a package. */
  campaignTitle: z.string().nullable(),
  thresholdPct: z.union([z.literal(50), z.literal(80), z.literal(100)]),
  usedPoints: pointsSchema,
  totalPoints: pointsSchema,
  createdAt: z.iso.datetime(),
});
export type BudgetAlert = z.infer<typeof budgetAlertSchema>;

/** `GET .../billing/alerts`: the business's alerts, newest first. */
export const budgetAlertsSchema = z.object({ alerts: z.array(budgetAlertSchema) });
export type BudgetAlerts = z.infer<typeof budgetAlertsSchema>;
