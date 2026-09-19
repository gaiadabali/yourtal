/**
 * Date and relative-time formatting for the Wallet surface (YT-0423,
 * YT-0424). Deliberately dependency-free — no Zod, no contracts import —
 * so it is free to use from any client leaf without touching the
 * initial-JS budget (docs/13b-typescript-standards.md §8).
 *
 * `formatRelativeToNow` takes `nowMs` as an explicit argument rather than
 * reading `Date.now()` itself, so callers (and their tests) control the
 * clock instead of this module depending on the wall clock.
 */

const walletDateFormatter = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" });
// `numeric: "always"`, not "auto" — "auto" substitutes idioms like "kemarin
// dulu" (the day before yesterday) for small day counts, which reads as
// vague next to a wallet's unlock/expiry countdown. Always spelling out the
// number ("2 hari yang lalu") keeps it unambiguous.
const relativeFormatter = new Intl.RelativeTimeFormat("id-ID", { numeric: "always" });

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** Formats an ISO instant as a short Indonesian date, e.g. "19 Sep 2026". */
export function formatWalletDate(iso: string): string {
  return walletDateFormatter.format(new Date(iso));
}

/**
 * Formats an ISO instant relative to `nowMs`, e.g. "3 hari lagi" (in 3
 * days) or "2 jam yang lalu" (2 hours ago). Picks the coarsest unit that
 * still reads naturally, per docs/17-surfaces-and-roles.md §3's "surfaced
 * before it matters" — an unlock or expiry date should read as a
 * timeframe, not just a calendar date buried in an ISO string.
 */
export function formatRelativeToNow(iso: string, nowMs: number): string {
  const diffMs = new Date(iso).getTime() - nowMs;
  const absMs = Math.abs(diffMs);

  if (absMs < MS_PER_HOUR) {
    return relativeFormatter.format(Math.round(diffMs / MS_PER_MINUTE), "minute");
  }
  if (absMs < MS_PER_DAY) {
    return relativeFormatter.format(Math.round(diffMs / MS_PER_HOUR), "hour");
  }
  return relativeFormatter.format(Math.round(diffMs / MS_PER_DAY), "day");
}
