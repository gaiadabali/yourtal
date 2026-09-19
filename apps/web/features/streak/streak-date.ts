/**
 * Calendar-day arithmetic for the streak feature (YT-0177), kept separate
 * from `streak-state.ts` so it is testable with plain `Date`s and no
 * localStorage.
 *
 * Deliberately UTC calendar days, not the visitor's local midnight — the
 * two shipped regions (`id-ID`, `en-AU`) are hours apart, and there is no
 * server session yet to anchor "today" to a authoritative clock (this is
 * mock-only, `streak-state.ts` explains why). UTC is an honest, documented
 * simplification, not a silent one: it means a user near a UTC-day
 * boundary can see their check-in window flip a little earlier or later
 * than their own midnight. Anchoring this to the user's real timezone is
 * real backend work (a server clock, a stored timezone) and is named as a
 * follow-up in the ticket report, not smuggled in here as a false fix.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` for the given instant, in UTC. */
export function dateKey(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

/** Whole UTC calendar days between two `YYYY-MM-DD` keys (`b` minus `a`). Negative if `b` is earlier. */
export function daysBetween(a: string, b: string): number {
  const msA = Date.parse(`${a}T00:00:00.000Z`);
  const msB = Date.parse(`${b}T00:00:00.000Z`);
  return Math.round((msB - msA) / MS_PER_DAY);
}
