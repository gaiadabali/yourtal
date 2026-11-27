import "server-only";

import { apiFetch } from "@/lib/api/api-fetch";
import type { ApiResult } from "@/lib/api/api-fetch";
import { godConsentStatusSchema } from "./god-notice-schemas";
import type { GodConsentStatus } from "./god-notice-schemas";

export function getGodConsentStatus(): Promise<ApiResult<GodConsentStatus>> {
  return apiFetch("/api/me/god-consent", godConsentStatusSchema);
}
