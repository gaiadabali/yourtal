import type { Voucher } from "@yourtal/contracts/voucher";
import { hashStringToSeed } from "@yourtal/contracts/mock-seed";
import type { MerchantRedemptionError } from "./merchant-redemption-errors";
import { classifyRedemptionEligibility } from "./merchant-redemption-errors";

/**
 * A display-only receipt — deliberately NOT a wire type. There is no live
 * BFF yet (docs/09-points-economy-and-redemption.md §8 describes
 * authorize -> capture; `merchant-data.ts`'s live data source stub fails
 * loudly rather than pretend this exists). `authorizationId`/`receiptId`
 * are shaped like the real API's response fields specifically so that
 * wiring a live implementation later only changes this function's body,
 * never its callers (same reasoning as
 * apps/web/features/burn/burn-redemption.ts's `BurnVoucherSummary`).
 */
export interface RedemptionReceipt {
  authorizationId: string;
  receiptId: string;
  voucherId: string;
  voucherCode: string;
  merchantName: string;
  amountCapturedMinor: number;
  remainingValueMinor: number;
  capturedAt: string;
}

export type AttemptRedemptionResult =
  { ok: true; receipt: RedemptionReceipt } | { ok: false; error: MerchantRedemptionError };

export interface AttemptRedemptionInput {
  voucher: Voucher;
  deviceMerchantId: string;
  deviceMerchantName: string;
  amountMinor: number;
  effectiveRemainingMinor: number;
  nowMs: number;
  idempotencyKey: string;
}

/**
 * Simulates the authorize -> capture round trip docs/09 §8.1 describes,
 * standing in for the real API until a BFF exists. Every call re-runs
 * `classifyRedemptionEligibility` from scratch — never trusts that the UI
 * already checked it — exactly like `burn-redemption.ts`'s `attemptBurn`
 * does for the burn flow, and for the same reason: the actual gate must be
 * here, not a restatement of a decision made earlier against
 * possibly-stale state.
 *
 * `idempotencyKey` is accepted (and threaded into the simulated failure
 * roll) even though nothing here can enforce true idempotency without a
 * server — docs/09 §8.1 calls it mandatory on every call, and carrying it
 * end to end now is what makes wiring the real client later a signature
 * that does not change. The SAME key is reused if a caller retries after a
 * `network_error`, so retrying a genuinely-failed attempt cannot itself be
 * read as a second, distinct redemption once a live idempotent backend
 * exists.
 *
 * The simulated transient failure is deterministic (hashed from the
 * idempotency key), never `Math.random()` — see
 * `burn-redemption.ts`'s `isSimulatedMerchantFailure` for the same
 * reasoning: a fixed, reachable failure case beats an unreproducible flake
 * for both manual QA and tests.
 */
export function attemptRedemption(input: AttemptRedemptionInput): AttemptRedemptionResult {
  const eligibilityError = classifyRedemptionEligibility({
    voucher: input.voucher,
    deviceMerchantId: input.deviceMerchantId,
    deviceMerchantName: input.deviceMerchantName,
    amountMinor: input.amountMinor,
    effectiveRemainingMinor: input.effectiveRemainingMinor,
    nowMs: input.nowMs,
  });
  if (eligibilityError) {
    return { ok: false, error: eligibilityError };
  }

  if (isSimulatedNetworkFailure(input.idempotencyKey)) {
    return { ok: false, error: { type: "network_error" } };
  }

  return {
    ok: true,
    receipt: {
      authorizationId: `auth_${input.idempotencyKey}`,
      receiptId: `rcpt_${input.idempotencyKey}`,
      voucherId: input.voucher.id,
      voucherCode: input.voucher.code,
      merchantName: input.voucher.merchantName,
      amountCapturedMinor: input.amountMinor,
      remainingValueMinor: Math.max(0, input.effectiveRemainingMinor - input.amountMinor),
      capturedAt: new Date(input.nowMs).toISOString(),
    },
  };
}

/**
 * Roughly one redemption attempt in twelve simulates a transient
 * merchant/network failure — reachable on demand (pick/retry an
 * idempotency key that hashes into the failing bucket) rather than
 * flaky.
 */
function isSimulatedNetworkFailure(idempotencyKey: string): boolean {
  return hashStringToSeed(idempotencyKey) % 12 === 0;
}

/** Builds a fresh idempotency key for one redemption attempt (docs/09 §8.1: mandatory on every call). */
export function generateIdempotencyKey(voucherId: string, nowMs: number): string {
  return `${voucherId}-${nowMs.toString(36)}-${hashStringToSeed(`${voucherId}:${nowMs}`).toString(36)}`;
}
