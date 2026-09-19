/**
 * What a viewer has actually watched. YT-0120.
 *
 * ## Coverage, never position
 *
 * Founder decision O-1 pays only on watching the **full length**, and O-4
 * says completion is "playback coverage, never where the playhead sits."
 * This module is that rule made arithmetic.
 *
 * The distinction is the whole control. A playhead is one number and it can
 * be put anywhere — dragging a seek bar to the end sets it to the duration
 * in one gesture. Coverage is the **set of seconds that were played**, and a
 * drag adds nothing to it, because nothing was played on the way. Seeking is
 * therefore not blocked: it simply does not earn. A viewer may skip around
 * freely, and the parts they skipped stay uncovered, and completion never
 * arrives.
 *
 * That matters more than it sounds. Risk 43 records a player spec that had
 * asserted, as expected behaviour, that seeking to the end completes a
 * campaign — written, reviewed and committed, and green only because Chrome
 * declines to fire `ended` on a seek. **A browser's incidental behaviour was
 * the only thing standing between that test and the hole.** A server that
 * counts coverage cannot be talked into the same mistake, because there is
 * no event to synthesise: `dispatchEvent(new Event("ended"))` produces no
 * seconds.
 *
 * ## Whole seconds, so "full" is reachable
 *
 * Coverage is bucketed into integer seconds. Floating-point playback
 * positions never sum to exactly the duration — the last frame is short, the
 * clock drifts, a report lands at 1799.9983 — so a rule stated as "covered
 * === duration" over floats is one no honest viewer can ever satisfy.
 * Rounding each report inward to whole seconds makes the target exact and
 * reachable, and costs at most one second of leniency per session.
 *
 * Deliberately NOT a percentage threshold. "95% counts as full" is a policy
 * decision that belongs to the founder, not a constant smuggled into a
 * helper — and under O-1 the answer today is that the full length means the
 * full length.
 */

/** A half-open span of playback, in whole seconds: `[fromSecond, toSecond)`. */
export interface CoverageInterval {
  readonly fromSecond: number;
  readonly toSecond: number;
}

/**
 * Normalises a report into whole seconds, **inward**.
 *
 * Inward, not nearest: rounding outward would credit a second that was only
 * partly played, and a viewer who nudged the bar 900 times would accumulate
 * 900 seconds they never watched. Reporting less than was watched is a cost
 * to an honest viewer of under a second; reporting more is a free credit to
 * a dishonest one.
 */
export function toWholeSeconds(fromSeconds: number, toSeconds: number): CoverageInterval | null {
  const from = Math.ceil(fromSeconds);
  const to = Math.floor(toSeconds);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || from < 0) {
    return null;
  }
  return { fromSecond: from, toSecond: to };
}

/**
 * Merges overlapping and adjacent intervals into a normalised, sorted set.
 *
 * Adjacent spans are joined (`[0,10)` and `[10,20)` become `[0,20)`) because
 * they describe continuous playback reported in two messages, and leaving
 * them apart would make the interval count depend on how often the client
 * happened to report.
 */
export function mergeCoverage(intervals: readonly CoverageInterval[]): CoverageInterval[] {
  const sorted = [...intervals]
    .filter((interval) => interval.toSecond > interval.fromSecond)
    .sort((left, right) => left.fromSecond - right.fromSecond);

  const merged: CoverageInterval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && interval.fromSecond <= last.toSecond) {
      if (interval.toSecond > last.toSecond) {
        merged[merged.length - 1] = { fromSecond: last.fromSecond, toSecond: interval.toSecond };
      }
      continue;
    }
    merged.push(interval);
  }
  return merged;
}

/** Total distinct seconds watched. Rewatching the same second counts once. */
export function coveredSeconds(intervals: readonly CoverageInterval[]): number {
  return mergeCoverage(intervals).reduce(
    (total, interval) => total + (interval.toSecond - interval.fromSecond),
    0,
  );
}

/** The spans of `[0, durationSeconds)` that have NOT been watched. */
export function uncoveredGaps(
  intervals: readonly CoverageInterval[],
  durationSeconds: number,
): CoverageInterval[] {
  const merged = mergeCoverage(intervals).filter(
    (interval) => interval.fromSecond < durationSeconds,
  );

  const gaps: CoverageInterval[] = [];
  let cursor = 0;
  for (const interval of merged) {
    if (interval.fromSecond > cursor) {
      gaps.push({ fromSecond: cursor, toSecond: interval.fromSecond });
    }
    cursor = Math.max(cursor, Math.min(interval.toSecond, durationSeconds));
  }
  if (cursor < durationSeconds) {
    gaps.push({ fromSecond: cursor, toSecond: durationSeconds });
  }
  return gaps;
}

/**
 * Whether the whole video has been watched.
 *
 * Expressed as "no gaps remain" rather than "covered >= duration". The two
 * agree, but only the first is unfoolable: a client reporting a span beyond
 * the end (`[0, 99999)`) would satisfy a total-seconds comparison while
 * leaving the middle of the video untouched. Asking what is still missing
 * cannot be inflated by claiming more.
 */
export function isFullyWatched(
  intervals: readonly CoverageInterval[],
  durationSeconds: number,
): boolean {
  return durationSeconds > 0 && uncoveredGaps(intervals, durationSeconds).length === 0;
}

/**
 * How far through, for a progress bar. Never used to decide a reward.
 *
 * Clamped to 1 because a report past the end must not show 140% — and
 * clamping here rather than at the call site keeps the one honest number in
 * one place.
 */
export function coverageFraction(
  intervals: readonly CoverageInterval[],
  durationSeconds: number,
): number {
  if (durationSeconds <= 0) return 0;
  const covered = coveredSeconds(
    mergeCoverage(intervals).map((interval) => ({
      fromSecond: Math.min(interval.fromSecond, durationSeconds),
      toSecond: Math.min(interval.toSecond, durationSeconds),
    })),
  );
  return Math.min(1, covered / durationSeconds);
}
