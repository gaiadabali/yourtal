"use server";

import { checkoutResultSchema, type CheckoutResult } from "@yourtal/contracts/checkout/checkout";
import { apiFetch, type ApiError } from "@/lib/api/api-fetch";

export type ConfirmCheckoutResult =
  { ok: true; result: CheckoutResult } | { ok: false; error: ApiError };

/**
 * 11.6.b: "Redeem now" — `POST /api/checkout`, which spends the locked
 * points and issues the voucher exactly once (4.7.a's saga: pre-check,
 * reserve, burn, activate, done). `@Idempotent` server-side, so every call
 * carries a fresh `idempotency-key` — same convention as
 * `dispute-voucher-action.ts`, this feature's own Server Action for the
 * exact same reason: the one place a Client Component (`burn-flow.tsx`) is
 * allowed to reach `apiFetch` (server-only).
 *
 * A refusal here (`quote_expired`, `insufficient_available`, or any other
 * 1.2.c code) is exhaustively worded in plain language by
 * `burn-errors.ts`'s `burnErrorFromApiError` — this action itself passes the
 * raw `ApiError` through unchanged.
 */
export async function confirmCheckoutAction(checkoutId: string): Promise<ConfirmCheckoutResult> {
  const result = await apiFetch("/api/checkout", checkoutResultSchema, {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    body: { checkoutId },
  });
  return result.ok ? { ok: true, result: result.data } : { ok: false, error: result.error };
}
