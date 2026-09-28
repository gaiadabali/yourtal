import { z } from "zod";
import { disputeReasonSchema } from "../checkout/dispute";
import { regionSchema } from "../region/region";

/**
 * `GET /api/staff/disputes`, TASKS.md 9.4.d, K13: captured-voucher disputes
 * (`checkout.dispute` where `outcome = 'queued'`, 4.7.c) waiting for staff.
 * List-only -- resolving one is 10.5, which needs Phase 10.
 */
export const staffDisputeSchema = z.object({
  voucherId: z.uuid(),
  sagaId: z.uuid(),
  userId: z.uuid(),
  /** The disputing user's own region, joined from `identity.user_profile`. Null if that row is gone (DSAR erasure). */
  region: regionSchema.nullable(),
  reason: disputeReasonSchema,
  createdAt: z.iso.datetime(),
});
export type StaffDispute = z.infer<typeof staffDisputeSchema>;

export const staffDisputeQueueSchema = z.array(staffDisputeSchema);
export type StaffDisputeQueue = z.infer<typeof staffDisputeQueueSchema>;
