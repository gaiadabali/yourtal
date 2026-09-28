"use server";

import {
  studioRedemptionListSchema,
  type StudioRedemptionEntry,
} from "@yourtal/contracts/device/studio-redemptions";
import { apiFetch, type ApiResult } from "@/lib/api/api-fetch";

/**
 * TASKS.md 8.2.g: Studio -> Redemptions, against A's merged
 * `studio-redemptions.controller.ts` (`GET /api/:tenantId/studio/redemptions`,
 * merged 774157de). Read-only — live only, no mock branch.
 */
export async function listRedemptionsLive(
  businessId: string,
): Promise<ApiResult<{ entries: StudioRedemptionEntry[] }>> {
  return apiFetch(`/api/${businessId}/studio/redemptions`, studioRedemptionListSchema);
}
