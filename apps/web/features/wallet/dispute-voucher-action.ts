"use server";

import { apiFetch } from "@/lib/api/api-fetch";
import {
  disputeResultSchema,
  type DisputeReason,
  type DisputeResult,
} from "@yourtal/contracts/checkout/dispute";
import type { ApiError } from "@/lib/api/api-fetch";

export type DisputeVoucherResult =
  { ok: true; result: DisputeResult } | { ok: false; error: ApiError };

/**
 * 6.5.b/4.7.c: "This voucher didn't work" — the viewer reports a voucher the
 * merchant would not honour. `POST /api/wallet/vouchers/:voucherId/dispute`
 * (apps/api/src/modules/checkout/dispute.controller.ts) is `@Idempotent`, so
 * every call carries a fresh `idempotency-key`; the dispute itself is safe
 * to call more than once regardless (an already-voided voucher replays
 * rather than erroring — services/voucher's `voidVoucher`), so a fresh key
 * per click is enough, no retry-with-the-same-key plumbing needed here.
 *
 * A Server Action, not a route handler: this is the one place a Client
 * Component in this feature is allowed to reach `apiFetch` (server-only) —
 * see `voucher-dispute-button.tsx`, its only caller.
 */
export async function disputeVoucherAction(
  voucherId: string,
  reason: DisputeReason,
): Promise<DisputeVoucherResult> {
  const result = await apiFetch(`/api/wallet/vouchers/${voucherId}/dispute`, disputeResultSchema, {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    body: { reason },
  });
  return result.ok ? { ok: true, result: result.data } : { ok: false, error: result.error };
}
