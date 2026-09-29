import { z } from "zod";
import { disputeReasonSchema } from "../checkout/dispute";
import { minorUnitsSchema } from "../money/money";
import { currencySchema } from "../money/money-value";
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

/**
 * `POST /api/staff/disputes/{voucherId}/resolve`, TASKS.md 10.5.b: a K13
 * dispute resolved in the user's favour posts a recovery line against the
 * merchant that captured it (`ledger.recoverCapture`), keyed on the
 * voucher's own capture so the same dispute cannot be posted twice.
 */
export const resolveDisputeRequestSchema = z.object({
  reason: z.string().min(1).max(2000),
});
export type ResolveDisputeRequest = z.infer<typeof resolveDisputeRequestSchema>;

export const disputeResolutionResultSchema = z.object({
  voucherId: z.uuid(),
  recoveryPostingId: z.string().min(1),
  amountMinor: minorUnitsSchema,
  currency: currencySchema,
});
export type DisputeResolutionResult = z.infer<typeof disputeResolutionResultSchema>;
