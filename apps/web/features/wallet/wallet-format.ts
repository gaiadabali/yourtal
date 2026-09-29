/**
 * Date and relative-time formatting for the Wallet surface (YT-0423,
 * YT-0424). Deliberately dependency-free — no Zod, no contracts import —
 * so it is free to use from any client leaf without touching the
 * initial-JS budget (docs/13b-typescript-standards.md §8).
 *
 * `formatRelativeToNow` takes `nowMs` as an explicit argument rather than
 * reading `Date.now()` itself, so callers (and their tests) control the
 * clock instead of this module depending on the wall clock.
 *
 * 6.1.c: `locale` is required on both — no default. A screen that forgets
 * to pass one must fail to compile, not silently render the wrong
 * region's language (F2).
 */

export type SupportedLocale = "en-AU" | "id-ID";

// A fixed zone per language, so the server's render and the browser's agree
// on the day (without one the server formats in UTC, the browser in local
// time, and React refuses to hydrate the mismatch).
const WALLET_DATE_FORMATTERS: Record<SupportedLocale, Intl.DateTimeFormat> = {
  "en-AU": new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Australia/Sydney",
  }),
  "id-ID": new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }),
};

// `numeric: "always"`, not "auto" — "auto" substitutes idioms like "kemarin
// dulu" (the day before yesterday) / "yesterday" for small day counts, which
// reads as vague next to a wallet's unlock/expiry countdown. Always spelling
// out the number keeps it unambiguous in either language.
const RELATIVE_FORMATTERS: Record<SupportedLocale, Intl.RelativeTimeFormat> = {
  "en-AU": new Intl.RelativeTimeFormat("en-AU", { numeric: "always" }),
  "id-ID": new Intl.RelativeTimeFormat("id-ID", { numeric: "always" }),
};

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** Formats an ISO instant as a short date, e.g. "19 Sep 2026". */
export function formatWalletDate(iso: string, locale: SupportedLocale): string {
  return WALLET_DATE_FORMATTERS[locale].format(new Date(iso));
}

/**
 * Formats an ISO instant relative to `nowMs`, e.g. "3 hari lagi" (`id-ID`)
 * or "in 3 days" (`en-AU`). Picks the coarsest unit that still reads
 * naturally, per docs/17-surfaces-and-roles.md §3's "surfaced before it
 * matters" — an unlock or expiry date should read as a timeframe, not just
 * a calendar date buried in an ISO string.
 */
export function formatRelativeToNow(iso: string, nowMs: number, locale: SupportedLocale): string {
  const diffMs = new Date(iso).getTime() - nowMs;
  const absMs = Math.abs(diffMs);
  const relativeFormatter = RELATIVE_FORMATTERS[locale];

  if (absMs < MS_PER_HOUR) {
    return relativeFormatter.format(Math.round(diffMs / MS_PER_MINUTE), "minute");
  }
  if (absMs < MS_PER_DAY) {
    return relativeFormatter.format(Math.round(diffMs / MS_PER_HOUR), "hour");
  }
  return relativeFormatter.format(Math.round(diffMs / MS_PER_DAY), "day");
}
