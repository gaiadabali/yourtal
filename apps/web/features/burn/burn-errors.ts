import type { Balance } from "@yourtal/contracts/balance";
import type { Listing, ListingStatus } from "@yourtal/contracts/listing";

/**
 * Every reason the burn flow can refuse to move points, as a discriminated
 * union on `type` (docs/13b-typescript-standards.md section 4) — never a
 * bare string. Every consumer `switch`es over `type` exhaustively with a
 * `never` default (see `burn-error-message.tsx` and `recoveryForError`
 * below), so adding a variant here without teaching both of those about it
 * is a compile error, not a silent blank screen.
 *
 * The numeric/date fields are display-only derived values, not the branded
 * `Points`/`IdrMinorUnits` types from `packages/contracts` — this union is a
 * UI artifact of the mock burn flow (no live redemption API exists yet, see
 * `burn-redemption.ts`), not a wire contract, and re-branding a number here
 * would need a runtime Zod import in client-reachable code, exactly what
 * the 170 KB initial-JS budget forbids (docs/13b section 8). See
 * `@yourtal/contracts/money/format`'s `asDisplayPoints` doc comment for the
 * same reasoning applied to formatting.
 */
export type BurnError =
  | { type: "insufficient_points"; short: number }
  | { type: "holdback_blocks"; unlocksAt: string }
  | { type: "lock_expired"; expiredAt: string }
  | { type: "listing_unavailable"; status: ListingStatus }
  | { type: "redemption_failed" };

/**
 * Pure eligibility check against the CURRENT wallet and listing — no clock
 * involved. The price-lock expiry is a separate, time-based check (see
 * `price-lock.ts`'s `isLockExpired`), checked independently in
 * `burn-redemption.ts`. Returns `null` when the redemption is allowed to
 * proceed.
 *
 * Distinguishes "insufficient_points" from "holdback_blocks": if the
 * available balance alone falls short but the pending (holdback) balance
 * would cover the gap once it unlocks, the user genuinely has enough — it
 * just is not spendable yet. Fraud detection is statistical and lags the
 * earning event, so newly-earned points vest after a delay before they can
 * be redeemed (docs/02-architecture.md's holdback section;
 * docs/09-points-economy-and-redemption.md). Telling the two apart is what
 * lets the UI explain "you have enough, it just is not available yet"
 * instead of the much more discouraging (and false) "you don't have
 * enough".
 */
export function classifyBurnEligibility(listing: Listing, balance: Balance): BurnError | null {
  if (listing.stockRemaining <= 0) {
    return { type: "listing_unavailable", status: listing.status };
  }
  if (balance.availablePoints >= listing.priceInPoints) {
    return null;
  }
  const totalIncludingPending = balance.availablePoints + balance.pendingPoints;
  if (totalIncludingPending >= listing.priceInPoints && balance.pendingUnlockAt !== null) {
    return { type: "holdback_blocks", unlocksAt: balance.pendingUnlockAt };
  }
  return {
    type: "insufficient_points",
    short: Math.max(0, listing.priceInPoints - totalIncludingPending),
  };
}

export type BurnErrorRecovery = { kind: "retry" } | { kind: "requote" } | { kind: "back_to_store" };

/**
 * What the flow can offer the user after each kind of failure. A transient
 * merchant/network failure is worth retrying with the same quote;
 * an expired lock can only be recovered by re-quoting (docs/tasks/phase-u-ui.md
 * YT-0422: "make the expired state unrecoverable except by re-quoting");
 * every other reason describes a fact about the listing or the wallet that
 * retrying will not change, so the only honest option is to go back.
 */
export function recoveryForError(error: BurnError): BurnErrorRecovery {
  switch (error.type) {
    case "redemption_failed":
      return { kind: "retry" };
    case "lock_expired":
      return { kind: "requote" };
    case "insufficient_points":
    case "holdback_blocks":
    case "listing_unavailable":
      return { kind: "back_to_store" };
    default: {
      const exhaustive: never = error;
      return exhaustive;
    }
  }
}
