"use server";

import {
  staffBusinessDetailSchema,
  type StaffBusinessDetail,
} from "@yourtal/contracts/staff/businesses";
import { apiFetch } from "@/lib/api/api-fetch";
import type { ApiError } from "@/lib/api/api-fetch";

export type StaffBusinessActionResult =
  { ok: true; business: StaffBusinessDetail } | { ok: false; error: ApiError };

async function post(path: string, reason: string): Promise<StaffBusinessActionResult> {
  const result = await apiFetch(path, staffBusinessDetailSchema, {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    body: { reason },
  });
  return result.ok ? { ok: true, business: result.data } : { ok: false, error: result.error };
}

/** TASKS.md 9.3.a: every one of these carries a required staff `reason`, for the audit trail. */
export async function approveBusinessKybAction(
  businessId: string,
  reason: string,
): Promise<StaffBusinessActionResult> {
  return post(`/api/staff/businesses/${businessId}/kyb/approve`, reason);
}

export async function rejectBusinessKybAction(
  businessId: string,
  reason: string,
): Promise<StaffBusinessActionResult> {
  return post(`/api/staff/businesses/${businessId}/kyb/reject`, reason);
}

export async function suspendBusinessAction(
  businessId: string,
  reason: string,
): Promise<StaffBusinessActionResult> {
  return post(`/api/staff/businesses/${businessId}/suspend`, reason);
}

export async function reinstateBusinessAction(
  businessId: string,
  reason: string,
): Promise<StaffBusinessActionResult> {
  return post(`/api/staff/businesses/${businessId}/reinstate`, reason);
}
