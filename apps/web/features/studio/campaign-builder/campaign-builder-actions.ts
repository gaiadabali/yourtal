"use server";

import { apiFetch } from "@/lib/api/api-fetch";
import type { ApiError } from "@/lib/api/api-fetch";
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
  | { ok: true; value: T }
  | {
      ok: false;
      message: string;
      code?: string;
      /** The refusal's other fields (e.g. the reward limit in points), for wording it in the author's language. */
      details?: Record<string, unknown>;
    };

/** A refusal with the API's own `code` and `details` kept, so the editor can word it itself. */
function refusal(error: ApiError): {
  ok: false;
  message: string;
  code?: string;
  details?: Record<string, unknown>;
} {
  if (error.kind !== "http") return { ok: false, message: error.message };
  return {
    ok: false,
    message: error.message,
    code: error.code,
    ...(error.details === undefined ? {} : { details: { ...error.details } }),
  };
}

/** `POST /api/:tenantId/studio/campaigns` (7.3.a) with a safe, always-valid starting point — see `newCampaignDraftDefaults`'s own doc comment for why. */
export async function createCampaignDraftLive(
  businessId: string,
  merchantName: string,
  copy: { title: string; synopsis: string },
): Promise<CampaignBuilderActionResult<CampaignDraft>> {
  const defaults = newCampaignDraftDefaults(copy);
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
  /** 13.11.a: the campaign's tags, taxonomy node ids only. */
  declaredInterests: string[];
  /** 14.2: the districts the campaign is shown in; empty is every district. */
  targetDistricts: string[];
}

/** `PATCH /api/:tenantId/studio/campaigns/:campaignId` (7.3.a) — every field the real DTO accepts that this editor has a control for. The budget saves with the reward (`setRewardConfigLive`). */
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
  if (!result.ok) return refusal(result.error);
  return { ok: true, value: apiDraftToWebDraft(result.data, merchantName) };
}

export interface RewardConfigPatch {
  allocationId: string;
  rewardPointsPerCompletion: number;
  accuracyBonusPoints: number;
  /** 14.2: the total budget, in points. */
  maxPointsForCampaign: number;
  /** 14.2: null is no daily cap. */
  dailyCapPoints: number | null;
}

/**
 * `PUT /api/:tenantId/studio/campaigns/:campaignId/reward` (7.3.c) — a full
 * replacement, safe to repeat. Every refusal (`reward_exceeds_ceiling`, the
 * 40% bonus ratio, `allocation_not_owned`, `allocation_not_partner_funded`)
 * comes back as this same `ok:false` shape with the server's own message and `code` —
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
  if (!result.ok) return refusal(result.error);
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

/** `POST /api/:tenantId/studio/campaigns/:campaignId/submit` (7.3.d). A `campaign_not_ready` refusal lists what is missing in `details.missing`. */
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
  if (!result.ok) return refusal(result.error);
  return { ok: true, value: apiDraftToWebDraft(result.data, merchantName) };
}
