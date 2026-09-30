"use server";

import { walletGiftSchema, type WalletGift } from "@yourtal/contracts/wallet/wallet-gift";
import { apiFetch } from "@/lib/api/api-fetch";

/** A refusal code from `WALLET_GIFT_REFUSALS`, or `failed` for anything else. */
export type GiftActionResult = { ok: true; gift: WalletGift } | { ok: false; code: string };

async function run(path: string, body?: unknown): Promise<GiftActionResult> {
  const result = await apiFetch(path, walletGiftSchema, {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    ...(body === undefined ? {} : { body }),
  });
  if (!result.ok) {
    return { ok: false, code: result.error.kind === "http" ? result.error.code : "failed" };
  }
  return { ok: true, gift: result.data };
}

/**
 * 13.20.b/c: the voucher's code stops working the moment this succeeds. No
 * revalidation here: it would re-render the voucher page, which then drops the
 * Gift dialog before it can say "Gift sent". Wallet reads are uncached anyway.
 */
export async function giftVoucherAction(
  voucherId: string,
  recipientEmail: string,
): Promise<GiftActionResult> {
  return run(`/api/wallet/vouchers/${encodeURIComponent(voucherId)}/gift`, { recipientEmail });
}

export async function acceptGiftAction(giftId: string): Promise<GiftActionResult> {
  return run(`/api/wallet/gifts/${encodeURIComponent(giftId)}/accept`);
}

export async function declineGiftAction(giftId: string): Promise<GiftActionResult> {
  return run(`/api/wallet/gifts/${encodeURIComponent(giftId)}/decline`);
}
