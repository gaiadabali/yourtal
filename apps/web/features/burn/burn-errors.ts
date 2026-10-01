import type { WalletSummary } from "@yourtal/contracts/wallet/wallet";
import type { LedgerErrorCode } from "@yourtal/contracts/ledger-internal/ledger-error";
import type { ApiError } from "@/lib/api/api-fetch";

/**
 * Every reason the checkout flow can refuse to move points, as a
 * discriminated union on `type` (docs/13b-typescript-standards.md section
 * 4) — never a bare string. Every consumer `switch`es over `type`
 * exhaustively with a `never` default (see `burn-error-message.tsx` and
 * `recoveryForError` below), so adding a variant here without teaching both
 * of those about it is a compile error, not a silent blank screen.
 *
 * 11.6.b: real checkout, real errors. `insufficient_points`/`holdback_blocks`
 * are a CLIENT-SIDE pre-check against the real wallet balance the redeem
 * page already fetched (`classifyBalanceEligibility`) — a nicer, instant
 * "you don't have enough" than waiting on a round trip for something we
 * already know. `lock_expired` fires either from the visible countdown
 * reaching zero, or from the server's own `quote_expired` refusal at
 * confirm time (`burnErrorFromApiError` folds both into this one shape,
 * since both mean exactly the same thing to the user). `checkout_*` are
 * every other 1.2.c refusal the SERVER can return at confirm time, grouped
 * into the three buckets a user can actually act on differently.
 */
export type BurnError =
  | { type: "insufficient_points"; short: number }
  | { type: "holdback_blocks"; unlocksAt: string }
  | { type: "lock_expired"; expiredAt: string }
  /** The wallet's balance changed between quoting and confirming, and it no longer covers the price — unlike `insufficient_points`, there is no known shortfall to state. */
  | { type: "insufficient_now" }
  /** The listing sold out or otherwise stopped existing between quoting and confirming. */
  | { type: "checkout_unavailable" }
  /** Any other closed 1.2.c refusal (region/audience/risk/governance) — a fact about the listing or account that retrying will not change. */
  | { type: "checkout_blocked" }
  /** A network hiccup, an unreadable response, or an unrecognised failure — worth a retry. */
  | { type: "checkout_failed" };

/**
 * Pure eligibility check against the CURRENT wallet and a real, locked
 * price — no clock involved. The price-lock expiry is a separate, time-based
 * check (`price-lock.ts`'s `isLockExpired`, and the server's own
 * `quote_expired`). Returns `null` when the redemption is allowed to
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
 * enough". `balance.pending` is soonest-unlock-first
 * (`wallet-mapping.ts`'s `toWalletSummary`), so its first entry is the
 * unlock date to show.
 */
export function classifyBalanceEligibility(
  pricePoints: number,
  balance: WalletSummary,
): BurnError | null {
  if (balance.availablePoints >= pricePoints) {
    return null;
  }
  const totalIncludingPending = balance.availablePoints + balance.pendingPoints;
  const soonestUnlock = balance.pending[0]?.unlockAt;
  if (totalIncludingPending >= pricePoints && soonestUnlock !== undefined) {
    return { type: "holdback_blocks", unlocksAt: soonestUnlock };
  }
  return {
    type: "insufficient_points",
    short: Math.max(0, pricePoints - totalIncludingPending),
  };
}

/**
 * Buckets every closed 1.2.c code (plus `listing_unavailable`, the one
 * quote-time refusal outside that enum — `checkout.ts`'s own
 * `QuoteRefusal`) into what a user can actually do about it. The `satisfies`
 * clause is exhaustive over `LedgerErrorCode` — a new code added to 1.2.c's
 * shared enum without a line here is a compile error, not a silently
 * unworded refusal.
 */
const CODE_BUCKET = {
  quote_expired: "quote_expired",
  insufficient_available: "insufficient_available",
  allocation_exhausted: "unavailable",
  sold_out: "unavailable",
  listing_unavailable: "unavailable",
  region_mismatch: "blocked",
  audience_blocked: "blocked",
  campaign_cap_reached: "blocked",
  velocity_capped: "blocked",
  solvency_blocked: "blocked",
  already_granted: "blocked",
  idempotency_conflict: "blocked",
  kill_switch: "blocked",
  currency_mismatch: "blocked",
  dispute_window_open: "blocked",
  statement_not_open: "blocked",
} as const satisfies Record<
  LedgerErrorCode | "listing_unavailable",
  "quote_expired" | "insufficient_available" | "unavailable" | "blocked"
>;

/**
 * Maps a raw `ApiError` from either `quoteCheckout` or `confirmCheckoutAction`
 * into the one plain-language shape the UI knows how to render — the "the
 * ledger doesn't word things, the web does" rule this codebase applies
 * everywhere else (`wallet-history-copy.ts`'s doc comment). `error.message`
 * is the server's own (English-only, developer-facing) string and is never
 * shown to a viewer directly.
 *
 * `lockExpiresAt` backs the synthesized `lock_expired` case for a
 * server-side `quote_expired` refusal at confirm time — the same instant
 * the visible countdown already knows, since the server's 15-minute clock
 * and that instant are the same fact.
 */
export function burnErrorFromApiError(error: ApiError, lockExpiresAt: string): BurnError {
  if (error.kind !== "http") {
    return { type: "checkout_failed" };
  }
  const bucket = (CODE_BUCKET as Partial<Record<string, (typeof CODE_BUCKET)[LedgerErrorCode]>>)[
    error.code
  ];
  switch (bucket) {
    case "quote_expired":
      return { type: "lock_expired", expiredAt: lockExpiresAt };
    case "insufficient_available":
      return { type: "insufficient_now" };
    case "unavailable":
      return { type: "checkout_unavailable" };
    case "blocked":
      return { type: "checkout_blocked" };
    case undefined:
    default:
      return { type: "checkout_failed" };
  }
}

export type BurnErrorRecovery = { kind: "retry" } | { kind: "requote" } | { kind: "back_to_store" };

/**
 * What the flow can offer the user after each kind of failure. A transient
 * network/unrecognised failure is worth retrying with the same quote; an
 * expired lock can only be recovered by re-quoting (docs/09 §4.2: "make the
 * expired state unrecoverable except by re-quoting"); every other reason
 * describes a fact about the listing, the account or the wallet that
 * retrying will not change, so the only honest option is to go back.
 */
export function recoveryForError(error: BurnError): BurnErrorRecovery {
  switch (error.type) {
    case "checkout_failed":
      return { kind: "retry" };
    case "lock_expired":
      return { kind: "requote" };
    case "insufficient_points":
    case "insufficient_now":
    case "holdback_blocks":
    case "checkout_unavailable":
    case "checkout_blocked":
      return { kind: "back_to_store" };
    default: {
      const exhaustive: never = error;
      return exhaustive;
    }
  }
}
