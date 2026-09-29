"use server";

import {
  staffListingModerationItemSchema,
  type StaffListingModerationItem,
} from "@yourtal/contracts/staff/moderation";
import { apiFetch } from "@/lib/api/api-fetch";
import type { ApiError } from "@/lib/api/api-fetch";

export type StaffListingModerationActionResult =
  | { ok: true; listing: StaffListingModerationItem }
  | { ok: false; error: ApiError };

async function post(path: string, reason: string): Promise<StaffListingModerationActionResult> {
  const result = await apiFetch(path, staffListingModerationItemSchema, {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    body: { reason },
  });
  return result.ok ? { ok: true, listing: result.data } : { ok: false, error: result.error };
}

/** TASKS.md 9.2.a: only a listing the automated screen flagged (adult_only category, 1.1.d) ever reaches this queue. */
export async function approveListingModerationAction(
  listingId: string,
  reason: string,
): Promise<StaffListingModerationActionResult> {
  return post(`/api/staff/moderation/listings/${listingId}/approve`, reason);
}

export async function rejectListingModerationAction(
  listingId: string,
  reason: string,
): Promise<StaffListingModerationActionResult> {
  return post(`/api/staff/moderation/listings/${listingId}/reject`, reason);
}
