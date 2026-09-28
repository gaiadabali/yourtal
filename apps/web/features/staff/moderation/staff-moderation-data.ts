import "server-only";

import {
  listPendingVoucherBatchesResponseSchema,
  type StaffVoucherBatchRequest,
} from "@yourtal/contracts/staff/moderation";
import { apiFetch } from "@/lib/api/api-fetch";

/** TASKS.md 9.2.c: the voucher-batch half of the staff moderation queue. */
export async function listPendingVoucherBatches(): Promise<readonly StaffVoucherBatchRequest[]> {
  const result = await apiFetch(
    "/api/staff/moderation/voucher-batches",
    listPendingVoucherBatchesResponseSchema,
  );
  if (!result.ok)
    throw new Error(`Could not load pending voucher batches: ${result.error.message}`);
  return result.data.requests;
}
