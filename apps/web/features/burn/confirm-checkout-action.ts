"use server";

import { checkoutResultSchema, type CheckoutResult } from "@yourtal/contracts/checkout/checkout";
import { apiFetch, type ApiError } from "@/lib/api/api-fetch";
import { getWalletBalance } from "@/features/wallet/wallet-data";

export type ConfirmCheckoutResult =
  | {
      ok: true;
      result: CheckoutResult;
      /** The balance after the burn, read back, so the header can show it; absent if that read failed. */
      availablePoints?: number;
    }
  | { ok: false; error: ApiError };

/**
 * 11.6.b: "Redeem now" — `POST /api/checkout`, which spends the locked
 * points and issues the voucher exactly once (4.7.a's saga: pre-check,
 * reserve, burn, activate, done). `@Idempotent` server-side, so every call
 * carries a fresh `idempotency-key` — same convention as
 * `dispute-voucher-action.ts`, this feature's own Server Action for the
 * exact same reason: the one place a Client Component (`burn-flow.tsx`) is
 * allowed to reach `apiFetch` (server-only).
 *
 * On success it reads the balance back, because the layout's chip was drawn
 * before the burn and a client navigation does not draw it again.
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
  if (!result.ok) return { ok: false, error: result.error };
  const wallet = await getWalletBalance();
  return {
    ok: true,
    result: result.data,
    ...(wallet.ok ? { availablePoints: wallet.data.availablePoints } : {}),
  };
}
