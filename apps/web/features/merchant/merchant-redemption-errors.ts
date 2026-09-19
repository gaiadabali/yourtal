import type { Voucher } from "@yourtal/contracts/voucher";

/**
 * Every reason a counter device can refuse (or fail) a redemption, as a
 * discriminated union on `type` (docs/13b-typescript-standards.md §4) —
 * never a bare string. `docs/23-critique.md` and this ticket's brief are
 * both explicit that "Invalid" alone is useless when a customer is
 * standing at the counter: every variant here carries what a
 * plain-language message needs to say *why*, and `merchant-error-copy.ts`
 * switches over `type` exhaustively (`never` default) so a new variant
 * without matching copy is a compile error, not a blank message.
 *
 * `already_redeemed`, `expired` and `wrong_merchant` are read straight off
 * a real `Voucher`; `amount_exceeds_remaining_value` and
 * `requires_full_value_redemption` are about the amount the STAFF typed in,
 * checked against it. `network_error` is the one transient, retryable case
 * (docs/09 §8's authorize/capture call itself failing, not a fact about the
 * voucher) — see `merchant-redemption.ts`.
 */
export type MerchantRedemptionError =
  | { type: "voucher_not_found" }
  | { type: "already_redeemed" }
  | { type: "expired"; expiresAt: string }
  | { type: "wrong_merchant"; voucherMerchantName: string; deviceMerchantName: string }
  | { type: "amount_not_positive" }
  | { type: "amount_exceeds_remaining_value"; remainingValueMinor: number }
  | { type: "requires_full_value_redemption"; remainingValueMinor: number }
  | { type: "network_error" };

export interface EligibilityInput {
  voucher: Voucher;
  deviceMerchantId: string;
  deviceMerchantName: string;
  amountMinor: number;
  /**
   * `voucher.remainingValueIdr` minus whatever this device has already
   * captured or queued against this voucher earlier today (see
   * `merchant-today-log.ts`) — the actual spendable ceiling right now, not
   * the voucher's own possibly-stale field. Passing the raw field here
   * would let staff redeem the same voucher twice in a row before the
   * first capture round-trips.
   */
  effectiveRemainingMinor: number;
  nowMs: number;
}

/**
 * Pure, offline-capable eligibility check — every fact it needs is already
 * on the device (the cached voucher catalogue and today's local log), so
 * this runs identically with or without connectivity. It is called three
 * times over one redemption's life, always as the actual gate rather than
 * a restatement of something the UI already decided (same discipline as
 * `apps/web/features/burn/burn-redemption.ts`'s `classifyBurnEligibility`):
 * once to decide whether to even show the amount field, once right before
 * queuing offline, and once more inside `attemptRedemption` at the moment
 * of the real (simulated) authorize+capture call.
 *
 * Returns `null` when the redemption may proceed.
 */
export function classifyRedemptionEligibility(
  input: EligibilityInput,
): MerchantRedemptionError | null {
  const {
    voucher,
    deviceMerchantId,
    deviceMerchantName,
    amountMinor,
    effectiveRemainingMinor,
    nowMs,
  } = input;

  if (voucher.status === "redeemed" || voucher.status === "transferred") {
    return { type: "already_redeemed" };
  }
  if (voucher.status === "expired" || new Date(voucher.expiresAt).getTime() <= nowMs) {
    return { type: "expired", expiresAt: voucher.expiresAt };
  }
  // Compare IDENTIFIERS, never display names. `voucherSchema` gained
  // `merchantId` specifically so this check stops being a string comparison
  // of a label: two merchants can share a name, a merchant can rename an
  // outlet and invalidate every voucher already in customers' wallets, and
  // casing or whitespace drift rejects silently at the counter. The names
  // below are carried only so the error message can say which shop is which.
  if (voucher.merchantId !== deviceMerchantId) {
    return {
      type: "wrong_merchant",
      voucherMerchantName: voucher.merchantName,
      deviceMerchantName,
    };
  }
  if (amountMinor <= 0) {
    return { type: "amount_not_positive" };
  }
  if (amountMinor > effectiveRemainingMinor) {
    return { type: "amount_exceeds_remaining_value", remainingValueMinor: effectiveRemainingMinor };
  }
  // `minimum_spend` vouchers (docs/09 §8.2) are meant to carry their own
  // minimum threshold — `Listing.minimumSpendIdr` exists for exactly this,
  // but `Voucher` (packages/contracts/src/voucher/voucher.ts) does not
  // carry that field once the voucher is minted, which is a real contract
  // gap (raised to the architect, not something this ticket owns fixing).
  // Until it does, this device treats a `minimum_spend` voucher as
  // redeemable only in full, which is at least never wrong in the
  // merchant's favour.
  if (
    voucher.partialRedemptionPolicy === "minimum_spend" &&
    amountMinor !== effectiveRemainingMinor
  ) {
    return { type: "requires_full_value_redemption", remainingValueMinor: effectiveRemainingMinor };
  }
  return null;
}

export type RedemptionErrorRecovery =
  { kind: "retry" } | { kind: "edit_amount" } | { kind: "new_redemption" };

/**
 * What the flow can offer after each failure. A transient network failure
 * is worth retrying with the same amount; an amount problem is fixed by
 * editing the amount, not by starting over; everything else describes a
 * fact about the voucher itself that only a different voucher (or a
 * different payment method) resolves.
 */
export function recoveryForRedemptionError(
  error: MerchantRedemptionError,
): RedemptionErrorRecovery {
  switch (error.type) {
    case "network_error":
      return { kind: "retry" };
    case "amount_not_positive":
    case "amount_exceeds_remaining_value":
    case "requires_full_value_redemption":
      return { kind: "edit_amount" };
    case "voucher_not_found":
    case "already_redeemed":
    case "expired":
    case "wrong_merchant":
      return { kind: "new_redemption" };
    default: {
      const exhaustive: never = error;
      return exhaustive;
    }
  }
}
