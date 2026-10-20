import * as z from "zod";
import { regionSchema } from "../region/region";
import { currencySchema } from "../money/money-value";
import { minorUnitsSchema, pointsSchema } from "../money/money";
import { economyProposalSchema } from "./staff-economy";

/**
 * 5.1.g (F123): card purchases YourTal could not turn into points. The card
 * was charged, the ledger refused the points (the rate rose while the checkout
 * was open, or the amount paid did not match), so the purchase is parked as
 * `needs_review`. Staff settle it by refunding the card in full through the
 * processor, with two-person approval; the brand then buys again at today's
 * price. Points that were delivered are never refunded (F107), and these never
 * were. `refund-proposals` reuse `EconomyProposal` (kind `refund_purchase`).
 */
export const parkedPurchaseStatusSchema = z.enum(["needs_review", "refunded"]);
export type ParkedPurchaseStatus = z.infer<typeof parkedPurchaseStatusSchema>;

export const parkedPurchaseSchema = z
  .object({
    purchaseId: z.uuid(),
    businessId: z.uuid(),
    /** The business's legal name; null if the business has gone. */
    businessName: z.string().nullable(),
    region: regionSchema,
    currency: currencySchema,
    tierKey: z.string().nullable(),
    /** What the brand asked for: points, ex-GST subtotal, GST and the total it was to be charged. */
    points: pointsSchema,
    subtotalMinor: minorUnitsSchema,
    taxMinor: minorUnitsSchema,
    totalMinor: minorUnitsSchema,
    status: parkedPurchaseStatusSchema,
    /** Why the points were not granted, in the ledger's or the checker's words (kept once refunded). */
    reason: z.string().min(1),
    /** When the processor said the card was charged. */
    paidAt: z.iso.datetime().nullable(),
    refundedAt: z.iso.datetime().nullable(),
    /** The staff member whose approval sent the refund; null if the processor refunded it elsewhere. */
    refundedBy: z.string().nullable(),
    /** The pending refund proposal, if one is waiting for a second staff member. */
    proposal: economyProposalSchema.nullable(),
    /** False when there is nothing to refund through (no payment reference); the row explains why in `reason`. */
    refundable: z.boolean(),
  })
  .strict();
export type ParkedPurchase = z.infer<typeof parkedPurchaseSchema>;

/** Parked purchases first (oldest payment first), then the last refunded ones, newest first. */
export const parkedPurchasesSchema = z
  .object({
    region: regionSchema,
    purchases: z.array(parkedPurchaseSchema),
  })
  .strict();
export type ParkedPurchases = z.infer<typeof parkedPurchasesSchema>;

export const proposeRefundBodySchema = z.object({
  reason: z.string().min(1).max(500),
});
export type ProposeRefundBody = z.infer<typeof proposeRefundBodySchema>;
