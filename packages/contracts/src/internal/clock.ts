/**
 * Every generator in this package derives its dates from an injected
 * reference instant, never from `Date.now()`. That is the whole determinism
 * contract: two calls with the same seed and the same reference instant must
 * produce byte-identical output, on any machine, on any day.
 *
 * `DEFAULT_REFERENCE_INSTANT` is a fixed point in time (not "now"), used as
 * the default when a caller does not supply one. Because it is a constant,
 * fixtures built against it — including the "expiring within the hour" and
 * "already expired" awkward cases — never drift.
 */
export const DEFAULT_REFERENCE_INSTANT: Date = new Date("2026-09-19T09:00:00.000Z");

const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

export function addSeconds(instant: Date, seconds: number): Date {
  return new Date(instant.getTime() + seconds * MS_PER_SECOND);
}

export function addMinutes(instant: Date, minutes: number): Date {
  return addSeconds(instant, minutes * SECONDS_PER_MINUTE);
}

export function addHours(instant: Date, hours: number): Date {
  return addMinutes(instant, hours * MINUTES_PER_HOUR);
}

export function addDays(instant: Date, days: number): Date {
  return addHours(instant, days * HOURS_PER_DAY);
}

export function toIsoString(instant: Date): string {
  return instant.toISOString();
}
