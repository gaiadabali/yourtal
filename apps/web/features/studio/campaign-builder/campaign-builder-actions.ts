"use server";

import { apiFetch } from "@/lib/api/api-fetch";
import type { CampaignDraft } from "./campaign-draft";
import {
  apiCampaignDraftSchema,
  apiDraftToWebDraft,
  apiRewardConfigResultSchema,
  apiRewardResultToWebDraft,
  newCampaignDraftDefaults,
} from "./campaign-draft-live-mapping";

/**
 * Client-invokable Server Actions wrapping 7.3's real campaign-authoring
 * endpoints (`apps/api/src/modules/studio/campaign-draft.controller.ts`) —
 * same reasoning `team-live-actions.ts`/`media-upload-actions.ts` give:
 * `campaign-builder-screen.tsx` is a `"use client"` leaf, so it cannot call
 * `campaign-builder-data.ts` (`"server-only"`) directly. This file is that
 * leaf's live counterpart, mirroring `team-live-actions.ts`'s
 * `{ok:true,value}|{ok:false,message}` shape (mapping is out of scope this
 * pass — see `campaign-draft-live-mapping.ts`'s own doc comment for exactly
 * which fields do not round-trip yet).
 */
export type CampaignBuilderActionResult<T> =
  { ok: true; value: T } | { ok: false; message: string };

/** `POST /api/:tenantId/studio/campaigns` (7.3.a) with a safe, always-valid starting point — see `newCampaignDraftDefaults`'s own doc comment for why. */
export async function createCampaignDraftLive(
  businessId: string,
  merchantName: string,
): Promise<CampaignBuilderActionResult<CampaignDraft>> {
  const defaults = newCampaignDraftDefaults();
  const result = await apiFetch(`/api/${businessId}/studio/campaigns`, apiCampaignDraftSchema, {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    body: defaults,
  });
  if (!result.ok) return { ok: false, message: result.error.message };
  return { ok: true, value: apiDraftToWebDraft(result.data, merchantName) };
}

export interface CampaignDraftDetailsPatch {
  title: string;
  synopsis: string;
  /** Omitted while no chapters exist yet — chapters aren't wired live this pass (TASKS.md 7.8.b's note), so a real, server-known duration from creation or a prior real video upload should never be overwritten by a stale "0 chapters" computation. */
  durationSeconds?: number;
  contentCategory: string;
  audience: string;
  startsAt: string;
  endsAt: string;
  openViewing: boolean;
  teaserStartSeconds: number;
  captionsUrl: string | null;
}

/** `PATCH /api/:tenantId/studio/campaigns/:campaignId` (7.3.a) — every field the real DTO accepts that this editor has a control for (see TASKS.md 7.8.b's note for `targeting.districts`/`budget`, which the DTO has no field for at all). */
export async function updateCampaignDraftDetailsLive(
  businessId: string,
  campaignId: string,
  merchantName: string,
  patch: CampaignDraftDetailsPatch,
): Promise<CampaignBuilderActionResult<CampaignDraft>> {
  const result = await apiFetch(
    `/api/${businessId}/studio/campaigns/${campaignId}`,
    apiCampaignDraftSchema,
    { method: "PATCH", body: patch },
  );
  if (!result.ok) return { ok: false, message: result.error.message };
  return { ok: true, value: apiDraftToWebDraft(result.data, merchantName) };
}

/**
 * `POST /api/:tenantId/studio/campaigns/:campaignId/submit` (7.3.d) —
 * wired for real but not yet called from `campaign-editor-status-panel.tsx`:
 * that panel already disables the Submit button whenever `!isVerified`
 * (the real, live `business.isVerified` flag, wired since 7.8.b), which is
 * exactly what 7.8.d's Check asks for ("ready to submit, blocked by the
 * verification banner") — the button being correctly disabled makes this
 * call unreachable from the UI today regardless, since a real business is
 * never verified except through staff KYB review (9.3.b, later phase).
 * Left real and ready for whoever wires the button itself as this
 * feature's own next slice.
 */
export interface RewardConfigPatch {
  allocationId: string;
  rewardPointsPerCompletion: number;
  accuracyBonusPoints: number;
  maxPointsForCampaign: number;
}

/**
 * `PUT /api/:tenantId/studio/campaigns/:campaignId/reward` (7.3.c) — a full
 * replacement, safe to repeat. Every refusal (`reward_exceeds_ceiling`, the
 * 40% bonus ratio, `allocation_not_owned`, `allocation_not_partner_funded`)
 * comes back as this same `ok:false` shape with the server's own message —
 * shown inline in `campaign-editor-reward.tsx`, never silently swallowed.
 * On success, the server's own priced `rewardValueMinor`/`currency`
 * replaces the "ratio pending" state (7.3.h).
 */
export async function setRewardConfigLive(
  businessId: string,
  campaignId: string,
  merchantName: string,
  patch: RewardConfigPatch,
): Promise<CampaignBuilderActionResult<CampaignDraft>> {
  const result = await apiFetch(
    `/api/${businessId}/studio/campaigns/${campaignId}/reward`,
    apiRewardConfigResultSchema,
    { method: "PUT", body: patch },
  );
  if (!result.ok) return { ok: false, message: result.error.message };
  return {
    ok: true,
    value: apiRewardResultToWebDraft(
      result.data,
      merchantName,
      patch.allocationId,
      patch.accuracyBonusPoints,
    ),
  };
}

export async function submitCampaignDraftLive(
  businessId: string,
  campaignId: string,
  merchantName: string,
): Promise<CampaignBuilderActionResult<CampaignDraft>> {
  const result = await apiFetch(
    `/api/${businessId}/studio/campaigns/${campaignId}/submit`,
    apiCampaignDraftSchema,
    { method: "POST" },
  );
  if (!result.ok) return { ok: false, message: result.error.message };
  return { ok: true, value: apiDraftToWebDraft(result.data, merchantName) };
}
