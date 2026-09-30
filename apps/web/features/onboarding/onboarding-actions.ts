"use server";

import * as z from "zod";
import { apiFetch } from "@/lib/api/api-fetch";
import type { ApiResult } from "@/lib/api/api-fetch";
import { consentsResponseSchema } from "@/features/me/me-schemas";
import type { ConsentsResponse } from "@/features/me/me-schemas";

/**
 * Onboarding's own mutations (6.2.b). `updateInterestsAction` (the
 * follow-on step, only shown once ad-targeting consent is granted) is
 * `features/me/me-actions.ts`'s own export, reused as-is — same endpoint,
 * same shape, no reason for a second copy.
 *
 * Consent needs its own action rather than reusing
 * `me-actions.ts`'s `updateConsentAction`: that one always sends
 * `source: "settings_toggle"` (correct for Me, where every change IS a
 * settings toggle), and this is the ONE other place a consent is ever
 * recorded with a different, equally real source — `updateBody`'s
 * `"onboarding"` in `consent.controller.ts`.
 */
export async function recordOnboardingConsentAction(
  purpose: "declared_interest_targeting" | "marketing_communications",
  granted: boolean,
): Promise<ApiResult<ConsentsResponse>> {
  return apiFetch("/api/me/consents", consentsResponseSchema, {
    method: "POST",
    body: { purpose, state: granted ? "granted" : "withdrawn", source: "onboarding" },
  });
}

const followResultSchema = z.object({ following: z.boolean() });

/** `PUT /api/me/follows/:businessId` — the one write the Me follows section never needed (it only ever unfollows an existing entry). */
export async function followBusinessAction(
  businessId: string,
): Promise<ApiResult<{ following: boolean }>> {
  return apiFetch(`/api/me/follows/${businessId}`, followResultSchema, { method: "PUT" });
}

export async function unfollowBusinessAction(
  businessId: string,
): Promise<ApiResult<{ following: boolean }>> {
  return apiFetch(`/api/me/follows/${businessId}`, followResultSchema, { method: "DELETE" });
}
