/**
 * The price-lock window (docs/09-points-economy-and-redemption.md section
 * 4.2: "Price shown before add-to-cart, and locked for 10-15 minutes in
 * cart. Never change a price between the user deciding and the user
 * confirming. This is the fastest way to destroy trust in a points
 * economy."). Ten minutes — the conservative end of that range.
 *
 * Every function here works against an absolute instant (`lockExpiresAt`,
 * an ISO string computed once, server-side, when the price is first shown —
 * see `page.tsx`), never a client-owned duration that starts counting down
 * from whenever a component happens to mount. That distinction is the whole
 * point (docs/tasks/phase-u-ui.md YT-0422; docs/23-critique.md on metrics
 * theatre): a slow hydration, a backgrounded tab, or a client clock skew
 * must never silently extend the lock, because every check here recomputes
 * against `Date.now()` and the ORIGINAL quoted instant, never a decrementing
 * counter the client owns.
 */
export const PRICE_LOCK_DURATION_MS = 10 * 60 * 1000;

/** Computes the absolute instant a price quote expires, as an ISO string (serializable across the RSC boundary — docs/13b-typescript-standards.md section 8). */
export function computeLockExpiresAt(quotedAt: Date): string {
  return new Date(quotedAt.getTime() + PRICE_LOCK_DURATION_MS).toISOString();
}

/** Milliseconds remaining until `lockExpiresAt`, floored at 0 so callers never see a negative countdown. */
export function millisecondsUntilLock(lockExpiresAt: string, nowMs: number): number {
  return Math.max(0, new Date(lockExpiresAt).getTime() - nowMs);
}

/**
 * Whether the price lock has expired as of `nowMs`. This is the single
 * source of truth for "can this quote still be honoured" — the visible
 * countdown calls it to decide when to fire `onExpire`, and
 * `burn-redemption.ts`'s `attemptBurn` calls it again, independently, at the
 * moment of confirming. A stale render of the countdown can therefore never
 * let a purchase through past expiry: the actual gate is this function,
 * re-evaluated against a fresh clock read each time, not a boolean the UI
 * cached earlier.
 */
export function isLockExpired(lockExpiresAt: string, nowMs: number): boolean {
  return nowMs >= new Date(lockExpiresAt).getTime();
}
