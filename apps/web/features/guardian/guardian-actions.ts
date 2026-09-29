"use server";

import type { ApiResult } from "@/lib/api/api-fetch";
import type {
  ApproveGuardianConsentResult,
  RevokeGuardianConsentResult,
} from "@yourtal/contracts/identity/guardian";
import { approveGuardianConsent, revokeGuardianConsent } from "./guardian-api";

/**
 * `POST /api/guardian/:token/approve`. `idempotencyKey` is minted once per
 * page render (`page.tsx`, `crypto.randomUUID()`) and passed down as a
 * prop, the same "stable across a double-click of the same rendered
 * button" shape `purchase-points-action.ts`'s own doc comment describes —
 * not minted in here, or a retry after a dropped response would use a
 * fresh key and double-submit past the API's own idempotency guard.
 */
export async function approveGuardianConsentAction(
  token: string,
  idempotencyKey: string,
): Promise<ApiResult<ApproveGuardianConsentResult>> {
  return approveGuardianConsent(token, idempotencyKey);
}

/** `POST /api/guardian/:token/revoke` — same idempotency-key contract as approve, above. */
export async function revokeGuardianConsentAction(
  token: string,
  idempotencyKey: string,
): Promise<ApiResult<RevokeGuardianConsentResult>> {
  return revokeGuardianConsent(token, idempotencyKey);
}
