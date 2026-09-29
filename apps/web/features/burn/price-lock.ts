/**
 * The price-lock window (docs/09-points-economy-and-redemption.md section
 * 4.2: "Price shown before add-to-cart, and locked for 10-15 minutes in
 * cart. Never change a price between the user deciding and the user
 * confirming. This is the fastest way to destroy trust in a points
 * economy."). 11.6.b: the real lock is the ledger's own quote, which lives
 * 15 minutes (`services/ledger/internal/pricing/quotes.go`'s own doc
 * comment) — this constant now only drives the countdown bar's
 * percentage, never the lock's actual expiry.
 *
 * Every function here works against an absolute instant (`lockExpiresAt`,
 * the ISO string `POST /api/checkout/quote` returns the moment the price is
 * first shown — see `checkout-data.ts`), never a client-owned duration that
 * starts counting down from whenever a component happens to mount. That
 * distinction is the whole point (docs/09 §4.2; docs/23-critique.md on
 * metrics theatre): a slow hydration, a backgrounded tab, or a client clock
 * skew must never silently extend the lock, because every check here
 * recomputes against `Date.now()` and the SERVER-QUOTED instant, never a
 * decrementing counter the client owns.
 */
export const PRICE_LOCK_DURATION_MS = 15 * 60 * 1000;

/** Milliseconds remaining until `lockExpiresAt`, floored at 0 so callers never see a negative countdown. */
export function millisecondsUntilLock(lockExpiresAt: string, nowMs: number): number {
  return Math.max(0, new Date(lockExpiresAt).getTime() - nowMs);
}

/**
 * Whether the price lock has expired as of `nowMs`. This is the single
 * source of truth for "can this quote still be honoured" — the visible
 * countdown calls it to decide when to fire `onExpire`, and the confirm
 * server action (`confirm-checkout-action.ts`) re-checks server-side,
 * independently, at the moment of confirming (`quote_expired`, 1.2.c). A
 * stale render of the countdown can therefore never let a purchase through
 * past expiry: the actual gate is the server's own check, re-evaluated
 * against its own clock, not a boolean the UI cached earlier.
 */
export function isLockExpired(lockExpiresAt: string, nowMs: number): boolean {
  return nowMs >= new Date(lockExpiresAt).getTime();
}
