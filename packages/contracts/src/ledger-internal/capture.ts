import * as z from "zod";
import { minorUnitsSchema } from "../money/money";
import { currencySchema } from "../money/money-value";
import { regionSchema } from "../region/region";

/**
 * 4.6.f.2: post a voucher capture to the ledger, keyed on the voucher
 * service's capture id. services/voucher's outbox drainer is the caller.
 */
export const captureVoucherRequestSchema = z.object({
  captureId: z.string().min(1),
  region: regionSchema,
  merchantId: z.uuid(),
  amountMinor: minorUnitsSchema,
  currency: currencySchema,
});
export type CaptureVoucherRequest = z.infer<typeof captureVoucherRequestSchema>;

export const capturePostingSchema = z.object({
  captureId: z.string().min(1),
  region: regionSchema,
  merchantId: z.uuid(),
  amountMinor: minorUnitsSchema,
  currency: currencySchema,
  transferId: z.string().min(1),
  postedAt: z.iso.datetime(),
});
export type CapturePosting = z.infer<typeof capturePostingSchema>;

/**
 * 10.5.b: resolving a captured-voucher K13 dispute in the user's favour
 * posts a recovery line against the merchant that captured it — the reverse
 * of the capture, keyed on captureId so the same dispute cannot be posted
 * twice. Called by the staff dispute-resolution route once a review lands
 * in the user's favour.
 */
export const recoverCaptureRequestSchema = z.object({
  captureId: z.string().min(1),
  reason: z.string().min(1),
});
export type RecoverCaptureRequest = z.infer<typeof recoverCaptureRequestSchema>;

export const captureRecoveryPostingSchema = z.object({
  id: z.string().min(1),
  captureId: z.string().min(1),
  region: regionSchema,
  merchantId: z.uuid(),
  amountMinor: minorUnitsSchema,
  currency: currencySchema,
  reason: z.string().min(1),
  transferId: z.string().min(1),
  postedAt: z.iso.datetime(),
});
export type CaptureRecoveryPosting = z.infer<typeof captureRecoveryPostingSchema>;
