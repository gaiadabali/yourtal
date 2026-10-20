import * as z from "zod";
import { minorUnitsSchema } from "../money/money";
import { currencySchema } from "../money/money-value";
import { regionSchema } from "../region/region";

/**
 * 5.2 (F103, F104): payouts in Australia on Stripe Connect. A brand or a
 * charity onboards a connected account on the processor's own page; an
 * approved statement is then paid to the brand's bank. Indonesia has no real
 * payouts, so `available` is false there and nothing else applies.
 */

const bankLast4Schema = z.string().regex(/^[0-9]{4}$/);

/** Not set up, details being filled in or checked, or ready to be paid. */
export const payoutAccountStateSchema = z.enum(["not_started", "in_progress", "ready"]);
export type PayoutAccountState = z.infer<typeof payoutAccountStateSchema>;

export const disbursementStatusSchema = z.enum([
  "queued",
  "awaiting_account",
  "transferred",
  "paid",
  "failed",
]);
export type DisbursementStatus = z.infer<typeof disbursementStatusSchema>;

export const payoutAccountSchema = z.object({
  /** False outside Australia (F104): no account, no payouts. */
  available: z.boolean(),
  state: payoutAccountStateSchema,
  bankLast4: bankLast4Schema.nullable(),
  /** True when the processor asks for the details on its own page (Stripe); false when it is instant. */
  hostedOnboarding: z.boolean(),
});
export type PayoutAccount = z.infer<typeof payoutAccountSchema>;

/** How one approved statement's money is getting to the brand's bank. */
export const statementPayoutSchema = z.object({
  statementId: z.string().min(1),
  status: disbursementStatusSchema,
  amountMinor: minorUnitsSchema,
  currency: currencySchema,
  /** The bank the latest payout went to. */
  bankLast4: bankLast4Schema.nullable(),
  paidAt: z.iso.datetime().nullable(),
  failureCode: z.string().nullable(),
});
export type StatementPayout = z.infer<typeof statementPayoutSchema>;

/** `GET /api/:tenantId/studio/billing/payouts`. */
export const studioPayoutsSchema = z.object({
  account: payoutAccountSchema,
  /** A payout failed at the bank: new bank details pay it again. */
  payoutFailed: z.boolean(),
  /** An approved payout waits for the account to be set up. */
  waitingForAccount: z.boolean(),
  payouts: z.array(statementPayoutSchema),
});
export type StudioPayouts = z.infer<typeof studioPayoutsSchema>;

/** `GET /api/charities/:charityId/payouts`. */
export const charityPayoutsSchema = z.object({ account: payoutAccountSchema });
export type CharityPayouts = z.infer<typeof charityPayoutsSchema>;

/** Where to send the browser: the processor's onboarding page, or straight back when nothing is asked. */
export const payoutLinkSchema = z.object({ url: z.url() });
export type PayoutLink = z.infer<typeof payoutLinkSchema>;

/** The staff settlement screen's view of one approved payout. */
export const staffDisbursementSchema = z.object({
  id: z.uuid(),
  statementId: z.string().min(1),
  proposalId: z.uuid(),
  businessId: z.uuid(),
  region: regionSchema,
  currency: currencySchema,
  amountMinor: minorUnitsSchema,
  status: disbursementStatusSchema,
  failureCode: z.string().nullable(),
  attempt: z.number().int().min(1),
  bankLast4: bankLast4Schema.nullable(),
  createdAt: z.iso.datetime(),
  transferredAt: z.iso.datetime().nullable(),
  paidAt: z.iso.datetime().nullable(),
  failedAt: z.iso.datetime().nullable(),
});
export type StaffDisbursement = z.infer<typeof staffDisbursementSchema>;

export const staffDisbursementsSchema = z.object({
  region: regionSchema,
  disbursements: z.array(staffDisbursementSchema),
});
export type StaffDisbursements = z.infer<typeof staffDisbursementsSchema>;
