import type { Listing } from "@yourtal/contracts/listing";
import type { Balance } from "@yourtal/contracts/balance";
import { hashStringToSeed } from "@yourtal/contracts/mock-seed";
import type { BurnError } from "./burn-errors";
import { classifyBurnEligibility } from "./burn-errors";
import { isLockExpired } from "./price-lock";

/**
 * A display-only summary of what the user got — deliberately NOT a
 * `@yourtal/contracts/voucher` `Voucher`. There is no live redemption API
 * yet (docs/09-points-economy-and-redemption.md section 8: authorize →
 * capture against the merchant), so nothing is actually minted; this is
 * just enough shape to render a success screen. `faceValueIdr` is carried
 * as a plain `number` for the same reason `BurnError`'s fields are (see
 * `burn-errors.ts`'s doc comment).
 */
export interface BurnVoucherSummary {
  code: string;
  merchantName: string;
  title: string;
  faceValueIdr: number;
  redeemedAt: string;
}

export type BurnAttemptResult =
  { ok: true; voucher: BurnVoucherSummary } | { ok: false; error: BurnError };

export interface BurnAttemptInput {
  listing: Listing;
  balance: Balance;
  lockExpiresAt: string;
  nowMs: number;
}

/**
 * Simulates attempting the burn. No live redemption API exists yet, so this
 * stands in for an authorize+capture call, in three steps, each of them the
 * authoritative check — not a re-statement of something the UI already
 * decided:
 *
 *  1. Re-checks the price lock against `nowMs`, independently of whatever
 *     the visible countdown last rendered. This is what makes "the expired
 *     state unrecoverable" real rather than cosmetic (docs/tasks/phase-u-ui.md
 *     YT-0422, docs/23-critique.md on metrics theatre): even if a caller
 *     invoked this after the UI should have blocked it, the lock is
 *     re-evaluated here from scratch and refuses.
 *  2. Re-checks eligibility against the current balance — the same
 *     function `burn-flow.tsx` used to decide whether to even show a
 *     "confirm" button, run again here as the actual gate.
 *  3. Simulates the merchant honouring the voucher, deterministically from
 *     the listing id (never randomly), so the failure state is reachable
 *     and repeatable for manual QA and tests instead of being flaky.
 *
 * When a real BFF exists, only this function's body changes to a real
 * authorize+capture call; its signature — a discriminated result, never a
 * thrown exception for an expected failure (docs/13b section 4) — does not
 * need to.
 */
export function attemptBurn(input: BurnAttemptInput): BurnAttemptResult {
  if (isLockExpired(input.lockExpiresAt, input.nowMs)) {
    return { ok: false, error: { type: "lock_expired", expiredAt: input.lockExpiresAt } };
  }

  const eligibilityError = classifyBurnEligibility(input.listing, input.balance);
  if (eligibilityError) {
    return { ok: false, error: eligibilityError };
  }

  if (isSimulatedMerchantFailure(input.listing)) {
    return { ok: false, error: { type: "redemption_failed" } };
  }

  return {
    ok: true,
    voucher: {
      code: generateMockVoucherCode(input.listing.id, input.nowMs),
      merchantName: input.listing.merchantName,
      title: input.listing.title,
      faceValueIdr: input.listing.faceValueIdr,
      redeemedAt: new Date(input.nowMs).toISOString(),
    },
  };
}

/**
 * Roughly one listing in eight simulates the merchant/network failing to
 * honour the voucher. Deterministic per listing id (not random), so the
 * failure state is reachable on demand — pick a listing whose id hashes
 * into the failing bucket — rather than an intermittent, unreproducible
 * flake.
 */
function isSimulatedMerchantFailure(listing: Listing): boolean {
  return hashStringToSeed(`${listing.id}:redemption-outcome`) % 8 === 0;
}

function generateMockVoucherCode(listingId: string, nowMs: number): string {
  const seed = hashStringToSeed(`${listingId}:${nowMs}`);
  return seed.toString(36).toUpperCase().padStart(8, "0").slice(0, 10);
}
