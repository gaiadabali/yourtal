import { z } from "zod";
import { minorUnitsSchema } from "../money/money";
import { currencySchema } from "../money/money-value";
import { regionSchema } from "../region/region";
import { voucherStatusSchema } from "../voucher/voucher";

/** TASKS.md 1.2.b: a merchant's own capture activity, for the studio's reporting surface. */

export const merchantCaptureStatsRequestSchema = z.object({
  merchantId: z.uuid(),
  from: z.iso.date(),
  to: z.iso.date(),
});
export type MerchantCaptureStatsRequest = z.infer<typeof merchantCaptureStatsRequestSchema>;

export const merchantCaptureStatsSchema = z.object({
  merchantId: z.uuid(),
  currency: currencySchema,
  captureCount: z.number().int().min(0),
  capturedMinor: minorUnitsSchema,
});
export type MerchantCaptureStats = z.infer<typeof merchantCaptureStatsSchema>;

/** 13.10: a merchant's issued vouchers in one region, counted by public status. */
export const merchantVoucherStatusRequestSchema = z.object({
  merchantId: z.uuid(),
  region: regionSchema,
});
export type MerchantVoucherStatusRequest = z.infer<typeof merchantVoucherStatusRequestSchema>;

export const merchantVoucherStatusSchema = z.object({
  merchantId: z.uuid(),
  region: regionSchema,
  currency: currencySchema,
  rows: z.array(
    z.object({
      status: voucherStatusSchema,
      count: z.number().int().min(0),
      faceValueMinor: minorUnitsSchema,
    }),
  ),
});
export type MerchantVoucherStatus = z.infer<typeof merchantVoucherStatusSchema>;
