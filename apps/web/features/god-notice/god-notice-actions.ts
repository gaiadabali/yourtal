"use server";

import { apiFetch } from "@/lib/api/api-fetch";
import type { ApiResult } from "@/lib/api/api-fetch";
import { godConsentStatusSchema } from "./god-notice-schemas";
import type { GodConsentStatus } from "./god-notice-schemas";

/**
 * The adult's own Accept / Not now (god/TASKS.md 9.1.b). `noticeVersion` is
 * the version the page showed, so a page left open across a new version is
 * refused rather than recorded against wording the person never saw.
 */
export async function decideGodNoticeAction(
  decision: "accepted" | "declined",
  noticeVersion: string,
): Promise<ApiResult<GodConsentStatus>> {
  return apiFetch("/api/me/god-consent", godConsentStatusSchema, {
    method: "POST",
    body: { decision, noticeVersion },
  });
}

/** The "Stop combining my data with GOD" request (9.1.f, founder Q4). */
export async function withdrawGodNoticeAction(): Promise<ApiResult<GodConsentStatus>> {
  return apiFetch("/api/me/god-consent/withdraw", godConsentStatusSchema, { method: "POST" });
}
