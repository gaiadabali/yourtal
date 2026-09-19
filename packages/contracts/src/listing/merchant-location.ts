import { z } from "zod";

/**
 * One physical outlet a merchant redeems vouchers at (docs/tasks/phase-0-platform.md
 * YT-0502). A listing carries an array of these rather than a single
 * `district: string`, because a multi-branch merchant can only otherwise show
 * one outlet — and which branch honours a voucher is load-bearing for
 * redemption and for disputes, not cosmetic.
 *
 * `id` is what a voucher references (see `voucher.ts`'s `location` field) —
 * never `name`, for the same reason `voucher.ts.merchantId` exists rather
 * than comparing on `merchantName`: a display string is not a safe key, and
 * renaming an outlet must not silently invalidate a voucher already resting
 * on that name.
 */
export const merchantLocationSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  address: z.string().min(1).max(200),
  district: z.string().min(1).max(60),
});

export type MerchantLocation = z.infer<typeof merchantLocationSchema>;
