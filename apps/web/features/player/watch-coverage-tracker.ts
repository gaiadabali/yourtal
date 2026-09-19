import {
  mergeCoverage,
  uncoveredGaps,
  type CoverageInterval,
} from "@yourtal/contracts/watch/coverage";

/**
 * Client-side mirror of `watch-coverage.ts`'s question: not "did playback
 * reach a terminal event", but "what of the timeline is still missing".
 * YT-0551, implementing decision **O-4**.
 *
 * ## This is defence in depth, not the control
 *
 * The real refusal is server-side: checkpoint tokens at randomised
 * timestamps cannot be scrubbed for, and per-segment delivery logs show
 * whether the middle of the video was ever actually fetched. The server
 * refuses a claim missing coverage **regardless of what this file does**.
 *
 * The reason to gate the client's own hand-off on coverage too: a UI that
 * *appears* to reward scrubbing teaches people to try. Before this,
 * `use-watch-session.ts` set `hasEnded` from the DOM `ended` event alone,
 * and the only thing standing between that and scrub-to-complete was that
 * Chrome declines to fire `ended` on a seek — a browser's incidental
 * behaviour, not a control this app implemented. `video.dispatchEvent(new
 * Event("ended"))` from a console produced a completion regardless.
 *
 * ## Real seconds, not virtual ones
 *
 * Tracking happens against the underlying `<video>` element's own
 * `currentTime`/`duration` (real seconds into the placeholder asset), not
 * the campaign's advertised virtual timeline (`time-remap.ts`). The remap
 * is a linear, zero-intercept scale, so a set of real intervals covers
 * `[0, realDuration)` completely if and only if its image covers
 * `[0, virtualDuration)` completely — checking in real seconds avoids
 * re-deriving that scale here and disappears cleanly the day
 * `time-remap.ts` does (per that file's own note, once real per-campaign
 * encodes land and `campaign.durationSeconds` equals the asset's own
 * duration).
 *
 * ## What counts as "played": event source, not distance
 *
 * A tick is credited only when it is **not the direct result of a seek**.
 * Distinguishing "played" from "jumped" by the SIZE of the position change
 * would be exploitable — a scrub broken into many small steps would look
 * like ordinary playback to a threshold test. Distinguishing by **whether a
 * `seeking` event preceded this tick** has no such hole: any assignment to
 * `currentTime` — a drag, a keyboard press, a script — fires `seeking`
 * first, whatever the size of the jump. `useWatchSession` sets
 * `followsSeek` from exactly that event and clears it once consumed here.
 */

const TAIL_TOLERANCE_SECONDS = 0.3;

export interface CoverageTick {
  readonly previousRealSeconds: number;
  readonly currentRealSeconds: number;
  /** True if a `seeking` event fired since the last tick was recorded. */
  readonly followsSeek: boolean;
}

/**
 * Folds one tick into the tracked coverage.
 *
 * Refuses to credit anything when `followsSeek` is set, or when playback
 * did not move forward (a rewind is reported as its own forward span once
 * it resumes, exactly as the server-side model documents) — mirroring
 * `watch-progress-report.ts`'s "not_forward" refusal, without needing that
 * module's Zod schema (and its ~100 KB gz runtime) in this route's bundle.
 */
export function applyCoverageTick(
  coverage: readonly CoverageInterval[],
  tick: CoverageTick,
): readonly CoverageInterval[] {
  if (tick.followsSeek || tick.currentRealSeconds <= tick.previousRealSeconds) {
    return coverage;
  }
  return mergeCoverage([
    ...coverage,
    { fromSecond: tick.previousRealSeconds, toSecond: tick.currentRealSeconds },
  ]);
}

/**
 * Whether the tracked coverage amounts to having watched the whole thing.
 *
 * Allows only ONE remaining gap, and only if it sits at the very end and is
 * smaller than `TAIL_TOLERANCE_SECONDS` — the slack a real `<video>` element
 * leaves between its last `timeupdate` tick and its own reported `duration`
 * (frame rounding, not a grace period for skipping). A gap anywhere else, or
 * a bigger one, refuses: that is what makes a scrub-to-end land here as
 * incomplete rather than "close enough". Compare `keyboard-seek.spec.ts`'s
 * own "within one frame" tolerance for the same reasoning at the DOM layer.
 */
export function hasFullRealCoverage(
  coverage: readonly CoverageInterval[],
  realDurationSeconds: number,
): boolean {
  if (realDurationSeconds <= 0) {
    return false;
  }
  const gaps = uncoveredGaps(coverage, realDurationSeconds);
  if (gaps.length === 0) {
    return true;
  }
  if (gaps.length > 1) {
    return false;
  }
  const gap = gaps[0];
  if (!gap) {
    // Unreachable given the length check above; satisfies noUncheckedIndexedAccess.
    return false;
  }
  return (
    gap.toSecond - gap.fromSecond <= TAIL_TOLERANCE_SECONDS &&
    gap.toSecond >= realDurationSeconds - TAIL_TOLERANCE_SECONDS
  );
}
