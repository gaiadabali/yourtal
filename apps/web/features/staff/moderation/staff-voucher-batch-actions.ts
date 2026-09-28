"use server";

import {
  staffVoucherBatchRequestSchema,
  type StaffVoucherBatchRequest,
} from "@yourtal/contracts/staff/moderation";
import { apiFetch } from "@/lib/api/api-fetch";
import type { ApiError } from "@/lib/api/api-fetch";

export type StaffVoucherBatchActionResult =
  { ok: true; request: StaffVoucherBatchRequest } | { ok: false; error: ApiError };

async function post(path: string, reason: string): Promise<StaffVoucherBatchActionResult> {
  const result = await apiFetch(path, staffVoucherBatchRequestSchema, {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    body: { reason },
  });
  return result.ok ? { ok: true, request: result.data } : { ok: false, error: result.error };
}

/** TASKS.md 9.2.c: approving mints through 4.5; both carry a required `reason` for the audit trail. */
export async function approveVoucherBatchAction(
  requestId: string,
  reason: string,
): Promise<StaffVoucherBatchActionResult> {
  return post(`/api/staff/moderation/voucher-batches/${requestId}/approve`, reason);
}

export async function rejectVoucherBatchAction(
  requestId: string,
  reason: string,
): Promise<StaffVoucherBatchActionResult> {
  return post(`/api/staff/moderation/voucher-batches/${requestId}/reject`, reason);
}
