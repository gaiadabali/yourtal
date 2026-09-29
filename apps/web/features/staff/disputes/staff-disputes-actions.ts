"use server";

import {
  disputeResolutionResultSchema,
  type DisputeResolutionResult,
} from "@yourtal/contracts/staff/disputes";
import { apiFetch } from "@/lib/api/api-fetch";
import type { ApiError } from "@/lib/api/api-fetch";

export type StaffDisputeActionResult =
  { ok: true; result: DisputeResolutionResult } | { ok: false; error: ApiError };

/**
 * TASKS.md 10.5.b/12.3.d: resolves a K13 dispute in the user's favour --
 * posts the ledger's own recovery line against the merchant
 * (`staff-disputes.controller.ts`'s `resolve`). That route is now
 * `@Idempotent` (found by 12.1's `mutating-routes.test.ts`), so this sends
 * a fresh `Idempotency-Key` per call, the same pattern
 * `staff-risk-actions.ts` already uses for release/suspend.
 */
export async function resolveDisputeAction(
  voucherId: string,
  reason: string,
): Promise<StaffDisputeActionResult> {
  const result = await apiFetch(
    `/api/staff/disputes/${voucherId}/resolve`,
    disputeResolutionResultSchema,
    {
      method: "POST",
      headers: { "idempotency-key": crypto.randomUUID() },
      body: { reason },
    },
  );
  return result.ok ? { ok: true, result: result.data } : { ok: false, error: result.error };
}
