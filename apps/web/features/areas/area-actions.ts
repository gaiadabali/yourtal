"use server";

import { apiFetch } from "@/lib/api/api-fetch";
import type { ApiResult } from "@/lib/api/api-fetch";
import {
  areaPlacesResponseSchema,
  areaStatesResponseSchema,
  areaSummariesResponseSchema,
} from "@yourtal/contracts/areas/schema";
import type {
  AreaPlacesResponse,
  AreaStatesResponse,
  AreaSummariesResponse,
} from "@yourtal/contracts/areas/schema";

/**
 * F116: reads of the fixed area list for the pickers (Me's "My area" and
 * Studio's districts). Server Actions, so a picker only fetches the one state
 * the person opens (the Australian list is about 480 KB in all) and no list
 * reaches a client bundle. The API answers for the signed-in account's own
 * region; nothing here names one.
 */

export async function fetchAreaStatesAction(): Promise<ApiResult<AreaStatesResponse>> {
  return apiFetch("/api/areas", areaStatesResponseSchema);
}

export async function fetchAreaPlacesAction(
  stateCode: string,
): Promise<ApiResult<AreaPlacesResponse>> {
  return apiFetch(`/api/areas/states/${encodeURIComponent(stateCode)}`, areaPlacesResponseSchema);
}

/** Postcodes as people read them (suburb names), for a saved area or a targeting chip. */
export async function fetchAreaSummariesAction(
  postcodes: readonly string[],
): Promise<ApiResult<AreaSummariesResponse>> {
  if (postcodes.length === 0) return { ok: true, data: { region: "AU", areas: [] } };
  return apiFetch(
    `/api/areas/summaries?postcodes=${encodeURIComponent(postcodes.join(","))}`,
    areaSummariesResponseSchema,
  );
}
