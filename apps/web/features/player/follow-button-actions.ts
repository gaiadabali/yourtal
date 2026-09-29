"use server";

import { z } from "zod";
import { apiFetch } from "@/lib/api/api-fetch";
import type { ApiResult } from "@/lib/api/api-fetch";

const followStateSchema = z.object({ following: z.boolean() });

/** `PUT /api/me/follows/:businessId` (5.4.a) — the channel row's/channel page's Follow button. */
export async function followAction(businessId: string): Promise<ApiResult<{ following: boolean }>> {
  return apiFetch(`/api/me/follows/${businessId}`, followStateSchema, { method: "PUT" });
}

/** `DELETE /api/me/follows/:businessId`. */
export async function unfollowAction(
  businessId: string,
): Promise<ApiResult<{ following: boolean }>> {
  return apiFetch(`/api/me/follows/${businessId}`, followStateSchema, { method: "DELETE" });
}
