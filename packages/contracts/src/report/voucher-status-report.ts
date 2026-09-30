import { z } from "zod";
import { minorUnitsSchema } from "../money/money";
import { currencySchema } from "../money/money-value";
import { regionSchema } from "../region/region";
import { voucherStatusSchema } from "../voucher/voucher";

/**
 * 13.10: `GET /api/:tenantId/studio/reports/vouchers`. A business's own
 * issued vouchers in its region, counted by status, with their total face
 * value. Counts only, never a voucher or who holds it; below the F12 cohort
 * floor (10, or 20 when any of its listings is for teens) it is suppressed.
 */
export const voucherStatusReportRowSchema = z.object({
  status: voucherStatusSchema,
  count: z.number().int().min(0),
  faceValueMinor: minorUnitsSchema,
});
export type VoucherStatusReportRow = z.infer<typeof voucherStatusReportRowSchema>;

export const voucherStatusReportSchema = z.discriminatedUnion("suppressed", [
  z.object({
    suppressed: z.literal(false),
    region: regionSchema,
    currency: currencySchema,
    totalCount: z.number().int().min(0),
    /** Every status, zero included, redeemed first. */
    rows: z.array(voucherStatusReportRowSchema),
  }),
  z.object({
    suppressed: z.literal(true),
    floor: z.number().int().positive(),
  }),
]);
export type VoucherStatusReport = z.infer<typeof voucherStatusReportSchema>;
