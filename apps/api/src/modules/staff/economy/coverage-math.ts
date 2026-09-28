import type { Coverage } from "@yourtal/contracts/ledger-internal/economy";

/**
 * TASKS.md 9.5.a/9.5.b: everything this console derives from `Coverage`
 * without ever asking the ledger for B (the backing rate) directly --
 * `ledger-internal` exposes no "current rate" read, only `coverage()`
 * (ratio + reserve) and the propose/approve pair. Both figures below are the
 * exact inverse of how the fake ledger computed `ratio` in the first place
 * (`fake-ledger-economy.ts`'s `coverage()`): `ratio = reserveMinor /
 * outstandingValueMinor`, so `outstandingValueMinor = reserveMinor / ratio`.
 *
 * CLAUDE.md / F1: "B never reaches a client." Neither function here returns
 * B to anyone who did not already ask specifically for it on the rate
 * screen (9.5.b); the overview screen (9.5.a) only ever sees the spread.
 */

/** `reserveMinor - pointsOutstanding * B`, in the region's minor currency unit. */
export function reportedSpreadMinor(coverage: Coverage): number {
  if (coverage.nothingOwed) return coverage.reserveMinor;
  const outstandingValueMinor = coverage.reserveMinor / coverage.ratio;
  return Math.round(coverage.reserveMinor - outstandingValueMinor);
}

/**
 * The current effective backing rate, in micros per point -- shown ONLY on
 * 9.5.b's rate screen. `null` when nothing is outstanding yet to derive it
 * from (a brand-new region with no grants).
 */
export function currentBackingRateMicros(coverage: Coverage): number | null {
  if (coverage.nothingOwed || coverage.pointsOutstanding === 0 || coverage.ratio === 0) {
    return null;
  }
  const outstandingValueMinor = coverage.reserveMinor / coverage.ratio;
  return Math.round((outstandingValueMinor / coverage.pointsOutstanding) * 1_000_000);
}
