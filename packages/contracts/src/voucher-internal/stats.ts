import { z } from "zod";
import { minorUnitsSchema } from "../money/money";
import { currencySchema } from "../money/money-value";

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
