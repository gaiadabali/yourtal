import * as z from "zod";
import { regionSchema } from "../region/region";
import { currencySchema } from "../money/money-value";
import { pointsSchema } from "../money/money";
import { coverageSchema } from "../ledger-internal/economy";
import { regionSettingSchema } from "../ledger-internal/settings";

/**
 * TASKS.md 9.5: the staff console's economy screens. Built against the
 * EXISTING `ledger-internal` contract (1.2.a/1.2.f, Area A's own file, not
 * edited here) -- `coverageSchema` and `regionSettingSchema` are reused
 * directly rather than re-declared, so a staff reader and every other reader
 * of those same ledger fields can never drift.
 *
 * `staff.economy_proposal` (migration 20260929060100) is a staff-owned read
 * model, not a second ledger -- see that migration's own header for why it
 * exists (`ledger-internal` exposes no "list what is pending" operation).
 * `economyProposalSchema` below is that row's own shape.
 */

// -- two-person proposal queue (9.5.b/9.5.c) -------------------------------

export const economyProposalKindSchema = z.enum([
  "rate_change",
  "fund_marketing",
  "manual_purchase",
  "setting_change",
  /** 10.6.a: a statement payout, proposed here and approved through `ledger.approvePayout` -- see `staff/staff-settlement.ts`. */
  "approve_payout",
  /** 5.1.g: a paid card purchase the ledger would not turn into points, refunded in full. */
  "refund_purchase",
  /** 5.2.c: a new payout attempt for a disbursement the processor shows moved nothing. */
  "retry_disbursement",
]);
export type EconomyProposalKind = z.infer<typeof economyProposalKindSchema>;

export const economyProposalStatusSchema = z.enum(["pending", "approved", "rejected"]);
export type EconomyProposalStatus = z.infer<typeof economyProposalStatusSchema>;

export const economyProposalSchema = z
  .object({
    id: z.string().min(1),
    kind: economyProposalKindSchema,
    region: regionSchema,
    summary: z.string().min(1),
    proposedBy: z.string().min(1),
    /** `proposedBy`'s sign-in email, for a screen to name them. Only the list reads that show a proposer fill it; null when there is no email to show. */
    proposedByEmail: z.string().nullable().optional(),
    approvedBy: z.string().nullable(),
    status: economyProposalStatusSchema,
    reason: z.string().nullable(),
    createdAt: z.iso.datetime(),
    decidedAt: z.iso.datetime().nullable(),
  })
  .strict();
export type EconomyProposal = z.infer<typeof economyProposalSchema>;

// -- overview (9.5.a) -----------------------------------------------------

export const economyDaySchema = z.object({
  date: z.iso.date(),
  pointsIssued: pointsSchema,
  pointsRedeemed: pointsSchema,
});
export type EconomyDay = z.infer<typeof economyDaySchema>;

export const economyOverviewSchema = z
  .object({
    region: regionSchema,
    coverage: coverageSchema,
    dailySeries: z.array(economyDaySchema),
    /**
     * `reserveMinor - pointsOutstanding * B`, computed server-side from
     * `coverage`'s own `ratio`/`reserveMinor` -- B itself never crosses this
     * response (CLAUDE.md: "B never reaches a client" outside 9.5.b's own
     * screen). Negative if the region is under-covered, so this is NOT
     * `moneySchema` (which forbids a negative `amountMinor`).
     */
    reportedSpread: z.object({
      amountMinor: z.number().int(),
      currency: currencySchema,
    }),
    /** Point purchases recorded through THIS console (9.5.c) -- pending and decided. Business-initiated purchases (Studio billing, 7.5) feed the reserve above but have no per-purchase listing in `ledger-internal` yet (requested of Area A). */
    manualPurchases: z.array(economyProposalSchema),
  })
  .strict();
export type EconomyOverview = z.infer<typeof economyOverviewSchema>;

// -- rate management (9.5.b) -- finance only; B never leaves this screen --

export const rateScreenSchema = z
  .object({
    region: regionSchema,
    currency: currencySchema,
    /** Reverse-derived from `coverage()`'s own ratio/reserve -- never read from a client-facing field elsewhere. `null` while nothing is outstanding yet to derive it from. */
    currentBackingRateMicrosPerPoint: z.number().int().positive().nullable(),
    pending: z.array(economyProposalSchema),
  })
  .strict();
export type RateScreen = z.infer<typeof rateScreenSchema>;

export const proposeRateBodySchema = z.object({
  backingRateMicrosPerPoint: z.number().int().positive(),
  reason: z.string().min(1).max(500).optional(),
});
export type ProposeRateBody = z.infer<typeof proposeRateBodySchema>;

// -- marketing funding (9.5.c) -- two-person --

export const proposeMarketingFundingBodySchema = z.object({
  amountMinor: z.number().int().positive(),
  reason: z.string().min(1).max(500),
});
export type ProposeMarketingFundingBody = z.infer<typeof proposeMarketingFundingBodySchema>;

// -- manual point purchase (9.5.c) -- two-person, bank-transfer reference --

export const proposeManualPurchaseBodySchema = z.object({
  businessId: z.uuid(),
  points: pointsSchema,
  paidMinor: z.number().int().positive(),
  bankReference: z.string().min(1).max(200),
  reason: z.string().min(1).max(500).optional(),
});
export type ProposeManualPurchaseBody = z.infer<typeof proposeManualPurchaseBodySchema>;

// -- receipt programmes (2.9.c) -- what a partner's receipt package has paid --

export const receiptProgrammePackageSchema = z.object({
  allocationId: z.string().min(1),
  totalPoints: pointsSchema,
  remainingPoints: pointsSchema,
  boughtAt: z.iso.datetime(),
});
export type ReceiptProgrammePackage = z.infer<typeof receiptProgrammePackageSchema>;

export const receiptProgrammeEarnerSchema = z.object({
  /** The ledger's opaque user id, never an email. */
  userId: z.string().min(1),
  points: pointsSchema,
  receipts: z.number().int().min(0),
});
export type ReceiptProgrammeEarner = z.infer<typeof receiptProgrammeEarnerSchema>;

/** One partner with a `receipt_funder.<partnerId>` setting in the region. No field names the backing rate. */
export const receiptProgrammeRowSchema = z
  .object({
    partnerId: z.string().min(1),
    funderBusinessId: z.uuid(),
    funderName: z.string(),
    pointsPerReceipt: pointsSchema,
    packages: z.array(receiptProgrammePackageSchema),
    /** Receipt points paid from the funder's packages, all time. */
    paidPoints: pointsSchema,
    paidLast7Days: pointsSchema,
    /** Top 10 over the last 30 days. */
    topEarners: z.array(receiptProgrammeEarnerSchema).max(10),
  })
  .strict();
export type ReceiptProgrammeRow = z.infer<typeof receiptProgrammeRowSchema>;

export const receiptProgrammeRowsSchema = z.array(receiptProgrammeRowSchema);
export type ReceiptProgrammeRows = z.infer<typeof receiptProgrammeRowsSchema>;

// -- settings (9.5.d) -- every F12 setting, and points expiry, per region --

export const settingsScreenSchema = z
  .object({
    region: regionSchema,
    current: z.array(regionSettingSchema),
    pending: z.array(economyProposalSchema),
  })
  .strict();
export type SettingsScreen = z.infer<typeof settingsScreenSchema>;

export const proposeSettingBodySchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
  reason: z.string().min(1).max(500).optional(),
});
export type ProposeSettingBody = z.infer<typeof proposeSettingBodySchema>;

export const decideProposalBodySchema = z.object({
  note: z.string().min(1).max(500).optional(),
});
export type DecideProposalBody = z.infer<typeof decideProposalBodySchema>;
