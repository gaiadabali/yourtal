"use server";

import { getWalletVoucher } from "./wallet-data";

export type RevealVoucherCodeResult = { ok: true; code: string } | { ok: false };

/**
 * The redemption code, fetched after the page is on screen rather than
 * rendered into it: a code in the server-rendered page lands in the service
 * worker's page cache, and docs/15 rule 7 says a plaintext code is never
 * persisted client-side. A Server Action is a POST, which that cache never
 * stores. `ok: false` covers a voucher with no usable code and a failed read.
 */
export async function revealVoucherCodeAction(voucherId: string): Promise<RevealVoucherCodeResult> {
  const result = await getWalletVoucher(voucherId);
  return result.ok && result.data.code ? { ok: true, code: result.data.code } : { ok: false };
}
