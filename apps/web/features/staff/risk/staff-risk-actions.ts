"use server";

import { staffRiskFlagSchema, type StaffRiskFlag } from "@yourtal/contracts/staff/risk-queue";
import { apiFetch } from "@/lib/api/api-fetch";
import type { ApiError } from "@/lib/api/api-fetch";

export type StaffRiskActionResult =
  { ok: true; flag: StaffRiskFlag } | { ok: false; error: ApiError };

async function post(path: string, resolutionNote: string): Promise<StaffRiskActionResult> {
  const result = await apiFetch(path, staffRiskFlagSchema, {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    body: { resolutionNote },
  });
  return result.ok ? { ok: true, flag: result.data } : { ok: false, error: result.error };
}

/** TASKS.md 10.5.a: clears a flag, no suspension -- a false positive. */
export async function releaseRiskFlagAction(
  flagId: string,
  resolutionNote: string,
): Promise<StaffRiskActionResult> {
  return post(`/api/staff/risk/queue/${flagId}/release`, resolutionNote);
}

/** TASKS.md 10.5.a: confirms the risk and holds the account's balance into escrow (10.4.b). */
export async function suspendRiskFlagAction(
  flagId: string,
  resolutionNote: string,
): Promise<StaffRiskActionResult> {
  return post(`/api/staff/risk/queue/${flagId}/suspend`, resolutionNote);
}
