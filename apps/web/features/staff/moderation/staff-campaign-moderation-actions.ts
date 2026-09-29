"use server";

import {
  staffCampaignModerationCampaignSchema,
  type StaffCampaignModerationCampaign,
} from "@yourtal/contracts/staff/moderation";
import { apiFetch } from "@/lib/api/api-fetch";
import type { ApiError } from "@/lib/api/api-fetch";

export type StaffCampaignModerationActionResult =
  { ok: true; campaign: StaffCampaignModerationCampaign } | { ok: false; error: ApiError };

async function post(path: string, body: unknown): Promise<StaffCampaignModerationActionResult> {
  const result = await apiFetch(path, staffCampaignModerationCampaignSchema, {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    body,
  });
  return result.ok ? { ok: true, campaign: result.data } : { ok: false, error: result.error };
}

/** TASKS.md 9.2.a/9.2.d: "confirm or change" (1.1.d) -- `audience`/`contentCategory` are the moderator's own choice (pre-filled from the declared values, sent back whether confirmed or changed). */
export async function approveCampaignModerationAction(
  campaignId: string,
  params: { reason: string; audience: string; contentCategory: string },
): Promise<StaffCampaignModerationActionResult> {
  return post(`/api/staff/moderation/campaigns/${campaignId}/approve`, params);
}

export async function rejectCampaignModerationAction(
  campaignId: string,
  reason: string,
): Promise<StaffCampaignModerationActionResult> {
  return post(`/api/staff/moderation/campaigns/${campaignId}/reject`, { reason });
}
