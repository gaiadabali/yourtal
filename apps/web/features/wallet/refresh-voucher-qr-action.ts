"use server";

import { getWalletVoucherQr, type WalletQrDetail } from "./wallet-data";

export type RefreshVoucherQrResult = { ok: true; qr: WalletQrDetail } | { ok: false };

/**
 * Server Action wrapper around `getWalletVoucherQr` (server-only `apiFetch`)
 * so `use-voucher-qr-rotation.ts` — a Client Component hook — can ask for a
 * fresh batch of signed QR windows once its cached hour runs out, without
 * this feature growing a second, client-reachable `apiFetch` call site.
 */
export async function refreshVoucherQrAction(voucherId: string): Promise<RefreshVoucherQrResult> {
  const result = await getWalletVoucherQr(voucherId);
  return result.ok ? { ok: true, qr: result.data } : { ok: false };
}
