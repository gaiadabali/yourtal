/** The states a voucher batch request moves through; a YourTal reviewer decides it, never the business. */
export type VoucherRequestState = "pending" | "approved" | "rejected";

export interface VoucherRequestLike {
  state: VoucherRequestState;
  quantity: number;
}

/**
 * How many more vouchers this listing can be asked to issue: the stock the business declared,
 * less every request that is waiting or already granted. A declined request frees its share.
 * Guidance only; the reviewer and the platform decide what is minted.
 */
export function requestableStock(
  stockTotal: number,
  requests: readonly VoucherRequestLike[],
): number {
  const asked = requests
    .filter((request) => request.state !== "rejected")
    .reduce((sum, request) => sum + request.quantity, 0);
  return Math.max(0, stockTotal - asked);
}

/** Keys under `studio.inventory.voucherRequest.error`. */
export type VoucherRequestErrorKey = "quantity" | "overStock";

export interface VoucherRequestBody {
  quantity: number;
  reason: string | null;
}

/** Typed text to the request body. No price: stock is the only thing a request names. */
export function buildVoucherRequestBody(
  values: { quantity: string; reason: string },
  requestable: number,
): { ok: true; body: VoucherRequestBody } | { ok: false; error: VoucherRequestErrorKey } {
  const text = values.quantity.trim();
  const quantity = /^\d{1,9}$/.test(text) ? Number(text) : 0;
  if (quantity < 1) return { ok: false, error: "quantity" };
  if (quantity > requestable) return { ok: false, error: "overStock" };
  const reason = values.reason.trim();
  return { ok: true, body: { quantity, reason: reason === "" ? null : reason } };
}
