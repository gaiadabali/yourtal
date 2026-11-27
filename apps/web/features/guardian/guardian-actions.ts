"use server";

import type { ApiResult } from "@/lib/api/api-fetch";
import type {
  ApproveGuardianConsentResult,
  DecideGuardianGodNoticeResult,
  DeleteGuardianAccountResult,
  RevokeGuardianConsentResult,
} from "@yourtal/contracts/identity/guardian";
import {
  approveGuardianConsent,
  decideGuardianGodNotice,
  deleteGuardianAccount,
  revokeGuardianConsent,
} from "./guardian-api";

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

/** `POST /api/guardian/:token/god-notice` (9.1.c), same idempotency-key contract as approve. */
export async function decideGuardianGodNoticeAction(
  token: string,
  decision: "accepted" | "declined",
  idempotencyKey: string,
): Promise<ApiResult<DecideGuardianGodNoticeResult>> {
  return decideGuardianGodNotice(token, decision, idempotencyKey);
}

/** `POST /api/guardian/:token/revoke` — same idempotency-key contract as approve, above. */
export async function revokeGuardianConsentAction(
  token: string,
  idempotencyKey: string,
): Promise<ApiResult<RevokeGuardianConsentResult>> {
  return revokeGuardianConsent(token, idempotencyKey);
}

/**
 * `POST /api/guardian/:token/delete-account` (12.4.b #6) — same
 * idempotency-key contract as approve/revoke above, and same reasoning
 * `approveGuardianConsentAction`'s own doc comment gives: minted once by
 * the server page, not in here.
 */
export async function deleteGuardianAccountAction(
  token: string,
  idempotencyKey: string,
): Promise<ApiResult<DeleteGuardianAccountResult>> {
  return deleteGuardianAccount(token, idempotencyKey);
}
