import { z } from "zod";
import {
  type CoverageInterval,
  coveredSeconds,
  mergeCoverage,
  toWholeSeconds,
} from "./watch-coverage";

/**
 * Deciding whether a progress report could possibly be true. YT-0120, EW-01.
 *
 * ## Cumulative, not per-report
 *
 * The first version of this check compared one report's claimed span
 * against the time elapsed since the previous ACCEPTED report, with a fixed
 * tolerance added back in on every single report. That is exactly what let
 * `docs/audit/2026-09-25/engine-watch.md` §2's probe cover a 1,800s campaign
 * in 3s of wall clock: 600 requests, each judged in isolation, each getting
 * its own slice of tolerance, sum to whatever the attacker likes.
 *
 * The fix is to judge the SESSION, not the report. However many reports
 * arrive, and however they overlap, the total number of DISTINCT seconds
 * this session has ever claimed must not exceed the wall-clock time that has
 * passed since it started, plus one tolerance for the whole session. A
 * report that would push the running total past that line is refused,
 * whatever it claims about its own span — which is also why a report's own
 * `fromSeconds`/`toSeconds` no longer need to be checked against "time since
 * last report" at all: the cumulative total already accounts for every
 * second this session has ever been credited.
 *
 * ## Why this also closes the idle-then-claim and parallel-report holes
 *
 * "Sleep 90s, then claim any 93s span" no longer works: the running total
 * after that claim is 93s, and only 90s (plus the tolerance) has actually
 * elapsed since the session started, so it is refused exactly as a claim
 * made three seconds after starting would be. And because the total is
 * compared against the SESSION's `startedAt` rather than against a
 * per-report reference that a stale read can disagree about, two concurrent
 * reports racing the same stale `lastProgressAt` no longer help an attacker
 * — the row lock in `DrizzleWatchSessionRepository.recordProgress` is what
 * stops them computing the total from the same base at once, and this
 * function is what stops the total itself being too generous even when they
 * do not race.
 *
 * ## Why the tolerance is still a constant, not a percentage
 *
 * Same reasoning as before: batching, clock drift and a request delayed in
 * flight need a LITTLE slack, and a percentage grows with the size of the
 * claim, rewarding exactly the behaviour being checked. It is spent once per
 * session now rather than once per report, which is the whole fix.
 */

export const MAX_PLAYBACK_RATE = 1;

/** Absolute, in seconds, spent ONCE across the whole session — never per report. */
export const TOLERANCE_SECONDS = 3;

export const watchProgressReportSchema = z.object({
  sessionId: z.uuid(),
  /** Playback position this span started at. */
  fromSeconds: z.number().min(0),
  /** Playback position it ended at. Must be greater than `fromSeconds`. */
  toSeconds: z.number().min(0),
  /** Client clock, recorded for audit. Never trusted for the rate check. */
  reportedAt: z.iso.datetime(),
});

export type WatchProgressReport = z.infer<typeof watchProgressReportSchema>;

export type ReportVerdict =
  | { readonly accepted: true; readonly interval: CoverageInterval }
  | { readonly accepted: false; readonly reason: ReportRefusal };

export type ReportRefusal =
  | { readonly kind: "not_forward"; readonly detail: string }
  | {
      readonly kind: "faster_than_realtime";
      readonly cumulativeSeconds: number;
      readonly elapsedSeconds: number;
    }
  | {
      readonly kind: "beyond_duration";
      readonly toSeconds: number;
      readonly durationSeconds: number;
    }
  | { readonly kind: "sub_second"; readonly detail: string };

export interface ReportContext {
  /** Server clock when the SESSION started. The one reference the budget is measured from. */
  readonly startedAtMs: number;
  /** Server clock now. The client's own timestamp is never used here. */
  readonly nowServerMs: number;
  readonly durationSeconds: number;
  /** Every span this session has been credited so far, under the same lock as this judgement. */
  readonly existingCoverage: readonly CoverageInterval[];
}

/**
 * Judges one report against the session's whole history.
 *
 * Returns the coverage interval to record, or why it was refused. The
 * refusal is a value rather than an exception for the same reason as
 * before: a refused report is ordinary traffic, and an endpoint that throws
 * on ordinary traffic acquires a catch block that swallows real errors too.
 */
export function judgeProgressReport(
  report: WatchProgressReport,
  context: ReportContext,
): ReportVerdict {
  if (report.toSeconds <= report.fromSeconds) {
    return {
      accepted: false,
      reason: {
        kind: "not_forward",
        detail: "A progress span must move forwards. A rewind is reported as its own forward span.",
      },
    };
  }

  // Claiming past the end is either a bug or an attempt to satisfy a
  // total-seconds check. Refused where it arrives rather than neutralised
  // downstream.
  if (report.toSeconds > context.durationSeconds) {
    return {
      accepted: false,
      reason: {
        kind: "beyond_duration",
        toSeconds: report.toSeconds,
        durationSeconds: context.durationSeconds,
      },
    };
  }

  const interval = toWholeSeconds(report.fromSeconds, report.toSeconds);
  if (interval === null) {
    return {
      accepted: false,
      reason: {
        kind: "sub_second",
        detail:
          "The span does not contain a whole second once rounded inward. Nothing is credited, which is correct: a partly-played second was not watched.",
      },
    };
  }

  // The number this check actually cares about: not the claimed span's own
  // length, but how many NEW distinct seconds it would add once merged with
  // everything already credited. Merging first is what stops an attacker
  // inflating the total by re-claiming seconds already covered.
  const cumulativeSeconds = coveredSeconds(mergeCoverage([...context.existingCoverage, interval]));
  const elapsedSeconds = Math.max(0, (context.nowServerMs - context.startedAtMs) / 1_000);

  if (cumulativeSeconds > elapsedSeconds * MAX_PLAYBACK_RATE + TOLERANCE_SECONDS) {
    return {
      accepted: false,
      reason: { kind: "faster_than_realtime", cumulativeSeconds, elapsedSeconds },
    };
  }

  return { accepted: true, interval };
}

export function describeRefusal(refusal: ReportRefusal): string {
  switch (refusal.kind) {
    case "not_forward":
      return refusal.detail;
    case "faster_than_realtime":
      return (
        `This session would have ${String(refusal.cumulativeSeconds)}s of credited playback after ` +
        `${String(Math.round(refusal.elapsedSeconds))}s of real time. ` +
        `Impossible at ${String(MAX_PLAYBACK_RATE)}x, so it is refused rather than scored.`
      );
    case "beyond_duration":
      return `Reported position ${String(refusal.toSeconds)}s is past the campaign's ${String(refusal.durationSeconds)}s.`;
    case "sub_second":
      return refusal.detail;
  }
}
