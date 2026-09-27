import type { CounterVoucherPreview } from "@yourtal/contracts/device/counter-redemption";
import type { ApiError } from "@/lib/api/api-fetch";

/**
 * Every reason a counter redemption can be refused, keyed by a `code`
 * string rather than a closed discriminated union (docs/13b-typescript-
 * standards.md §4's usual pattern) — TASKS.md 8.2's REWRITE from a full
 * client-side `Voucher` object to a server-shaped lookup means most of
 * these codes now come from the server's own error envelope
 * (`{code, message}`, `apps/web/lib/api/api-fetch.ts`'s `ApiError`), which
 * this feature cannot exhaustively enumerate at compile time. The three
 * amount-related codes below are the exception: THIS feature computes
 * them, from `CounterVoucherPreview`'s own fields, before ever calling
 * authorize — so `classifyAmount` stays exhaustive over what it can
 * produce, even though `merchant-redemption-error-copy.ts`'s lookup by
 * `code` cannot be.
 */
export interface MerchantRedemptionError {
  code: string;
  /** Only present for `amount_exceeds_remaining_value` / `requires_full_value_redemption`. */
  remainingValueMinor?: number;
  /** Only present for `expired`, when the server sends one. */
  expiresAt?: string;
  /** The server's own message, shown verbatim for a code this feature has no specific copy for. */
  fallbackMessage?: string;
}

export type MerchantRedemptionErrorCode =
  "amount_not_positive" | "amount_exceeds_remaining_value" | "requires_full_value_redemption";

/**
 * The one eligibility fact this feature still checks itself, before ever
 * calling authorize: is the amount the staff typed in even sane against
 * THIS voucher's own remaining value and partial-redemption policy. Every
 * other fact (already redeemed, expired, wrong merchant) is the server's
 * to know, not this device's — see `counter-redemption-data.ts`.
 *
 * `partialRedemptionPolicy` is `"single_use" | "balance_carrying"`
 * (`@yourtal/contracts/device/counter-redemption`) — a NARROWER enum than
 * the consumer-facing `Voucher` contract's three values, because a
 * `minimum_spend` voucher's minimum is checked against the ORDER TOTAL
 * server-side (`counterAuthorizeRequestSchema.orderTotalMinor`), not
 * against `amountMinor` here.
 */
export function classifyAmount(
  preview: CounterVoucherPreview,
  amountMinor: number,
): MerchantRedemptionError | null {
  if (amountMinor <= 0) {
    return { code: "amount_not_positive" };
  }
  if (amountMinor > preview.remainingValueMinor) {
    return {
      code: "amount_exceeds_remaining_value",
      remainingValueMinor: preview.remainingValueMinor,
    };
  }
  if (
    preview.partialRedemptionPolicy === "single_use" &&
    amountMinor !== preview.remainingValueMinor
  ) {
    return {
      code: "requires_full_value_redemption",
      remainingValueMinor: preview.remainingValueMinor,
    };
  }
  return null;
}

/**
 * `apiFetch`'s `ApiError` has a `code` only for its `"http"` variant — a
 * `"network"` (fetch itself failed) or `"invalid_response"` (the server's
 * body didn't match its own contract) error carries no server code at all,
 * so both collapse to this feature's own `"network_error"`: from a
 * cashier's point of view, "the call didn't come back with an answer" is
 * one fact, however it happened server- or transport-side.
 */
export function fromApiError(error: ApiError): MerchantRedemptionError {
  if (error.kind === "http") {
    return { code: error.code, fallbackMessage: error.message };
  }
  return { code: "network_error", fallbackMessage: error.message };
}

export type RedemptionErrorRecovery =
  { kind: "retry" } | { kind: "edit_amount" } | { kind: "new_redemption" };

/**
 * What the flow can offer after each failure. A transient network failure
 * is worth retrying with the same amount; an amount problem is fixed by
 * editing the amount, not by starting over; everything else describes a
 * fact about the voucher that only a different voucher resolves.
 */
export function recoveryForRedemptionError(
  error: MerchantRedemptionError,
): RedemptionErrorRecovery {
  switch (error.code) {
    case "network_error":
      return { kind: "retry" };
    case "amount_not_positive":
    case "amount_exceeds_remaining_value":
    case "requires_full_value_redemption":
      return { kind: "edit_amount" };
    default:
      return { kind: "new_redemption" };
  }
}
