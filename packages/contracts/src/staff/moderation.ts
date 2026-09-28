import { z } from "zod";

/**
 * TASKS.md 9.2.c: the staff moderation queue's voucher-batch half --
 * `apps/api/src/modules/store/staff-voucher-batch-review.controller.ts`.
 * Mirrors `apps/api`'s own `VoucherBatchRequest` (store/persistence/
 * voucher-batch-request.repository.ts), which the merchant-facing
 * `VoucherBatchRequestController` already returns with no contracts-package
 * schema of its own -- this is the first one to need a documented shape
 * (the staff console reads it), so it is defined here rather than promoted
 * onto that undocumented interface.
 */
export const staffVoucherBatchRequestSchema = z
  .object({
    id: z.uuid(),
    listingId: z.uuid(),
    merchantId: z.uuid(),
    quantity: z.number().int().positive(),
    requestedBy: z.uuid(),
    reason: z.string().nullable(),
    state: z.enum(["pending", "approved", "rejected"]),
    approvedBy: z.uuid().nullable(),
    decidedAt: z.iso.datetime({ offset: true }).nullable(),
    mintedBatchId: z.string().min(1).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type StaffVoucherBatchRequest = z.infer<typeof staffVoucherBatchRequestSchema>;

export const listPendingVoucherBatchesResponseSchema = z
  .object({ requests: z.array(staffVoucherBatchRequestSchema) })
  .strict();
export type ListPendingVoucherBatchesResponse = z.infer<typeof listPendingVoucherBatchesResponseSchema>;

const staffReasonSchema = z.object({ reason: z.string().min(1).max(500) });

/** Both carry a required `reason` for the audit trail, same as 9.3.a's staff/businesses. */
export const approveVoucherBatchRequestSchema = staffReasonSchema;
export type ApproveVoucherBatchRequest = z.infer<typeof approveVoucherBatchRequestSchema>;

export const rejectVoucherBatchRequestSchema = staffReasonSchema;
export type RejectVoucherBatchRequest = z.infer<typeof rejectVoucherBatchRequestSchema>;
