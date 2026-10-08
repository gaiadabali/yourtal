import * as z from "zod";

/**
 * A merchant's request for more stock on one listing (`/api/{tenantId}/store/voucher-batch-requests`).
 * A YourTal moderator approves or declines it; approval mints the vouchers, so the business
 * never approves its own request.
 */
export const voucherBatchRequestStateSchema = z.enum(["pending", "approved", "rejected"]);
export type VoucherBatchRequestState = z.infer<typeof voucherBatchRequestStateSchema>;

export const voucherBatchRequestSchema = z.object({
  id: z.uuid(),
  listingId: z.uuid(),
  merchantId: z.uuid(),
  quantity: z.number().int().positive(),
  requestedBy: z.string().min(1),
  reason: z.string().nullable(),
  state: voucherBatchRequestStateSchema,
  approvedBy: z.string().nullable(),
  decidedAt: z.iso.datetime({ offset: true }).nullable(),
  mintedBatchId: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type VoucherBatchRequest = z.infer<typeof voucherBatchRequestSchema>;
