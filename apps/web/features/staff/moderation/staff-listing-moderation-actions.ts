"use server";

import {
  staffListingModerationItemSchema,
  type StaffListingModerationItem,
} from "@yourtal/contracts/staff/moderation";
import { apiFetch } from "@/lib/api/api-fetch";
import type { ApiError } from "@/lib/api/api-fetch";

export type StaffListingModerationActionResult =
  { ok: true; listing: StaffListingModerationItem } | { ok: false; error: ApiError };

async function post(path: string, body: unknown): Promise<StaffListingModerationActionResult> {
  const result = await apiFetch(path, staffListingModerationItemSchema, {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    body,
  });
  return result.ok ? { ok: true, listing: result.data } : { ok: false, error: result.error };
}

/**
 * TASKS.md 9.2.a: only a listing the automated screen flagged (adult_only
 * category, 1.1.d) ever reaches this queue. 12.4.c: "confirm or change" --
 * `audience`/`contentCategory` are the moderator's own choice (pre-filled
 * from the declared values, sent back whether confirmed or changed), the
 * same shape `approveCampaignModerationAction` already gives campaigns.
 */
export async function approveListingModerationAction(
  listingId: string,
  params: { reason: string; audience: string; contentCategory: string },
): Promise<StaffListingModerationActionResult> {
  return post(`/api/staff/moderation/listings/${listingId}/approve`, params);
}

export async function rejectListingModerationAction(
  listingId: string,
  reason: string,
): Promise<StaffListingModerationActionResult> {
  return post(`/api/staff/moderation/listings/${listingId}/reject`, { reason });
}
