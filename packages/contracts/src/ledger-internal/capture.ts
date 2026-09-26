import { z } from "zod";
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
