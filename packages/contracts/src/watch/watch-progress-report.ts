import { z } from "zod";
import { type CoverageInterval, toWholeSeconds } from "./watch-coverage";

/**
 * Deciding whether a progress report could possibly be true. YT-0120.
 *
 * ## The check that needs no client cooperation
 *
 * A client says "I played seconds 600 to 660". The server knows how long it
 * has been since that client's last report. **You cannot watch sixty seconds
 * of video in four seconds of wall-clock time at 1x**, so a report claiming
 * more playback than time has passed is not a suspicious pattern to be
 * scored — it is arithmetically impossible, and it is refused.
 *
 * This is the half of `docs/22`'s fraud model that survives without the
 * client's help. It does not depend on the player behaving, on an event
 * firing, or on a token being kept secret. A scripted client that simply
 * POSTs progress as fast as it can is stopped by the clock.
 *
 * ## Why a tolerance exists, and why it is small
 *
 * Reports are batched, clocks drift, and a request can be delayed in
 * flight — so a report covering slightly more than the elapsed window is
 * ordinary. The tolerance is a few seconds, not a percentage: a percentage
 * grows with the claim, which rewards exactly the behaviour being checked.
 * An attacker gains at most `TOLERANCE_SECONDS` per report, and reports are
 * rate-limited by the same clock.
 *
 * ## What this deliberately does NOT do
 *
 * It does not reject a **seek**. Jumping forward produces a report whose
 * start is beyond the last position, and that is a legitimate thing a viewer
 * can do — it simply earns nothing, because the skipped seconds are never
 * covered (`watch-coverage.ts`). Blocking seeks would be a worse product for
 * no security gain; the coverage rule already makes them pointless as an
 * attack.
 *
 * It also does not reject a **rewind**. Re-watching is ordinary, and the
 * coverage set counts a second once however often it is played.
 */

export const MAX_PLAYBACK_RATE = 1;

/**
 * Absolute, in seconds. Batching and clock skew, not a share of the claim —
 * a percentage tolerance grows with the size of the lie.
 */
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
  | { readonly kind: "faster_than_realtime"; readonly claimedSeconds: number; readonly elapsedSeconds: number }
  | { readonly kind: "beyond_duration"; readonly toSeconds: number; readonly durationSeconds: number }
  | { readonly kind: "sub_second"; readonly detail: string };

export interface ReportContext {
  /** Server clock at the previous accepted report, or the session start. */
  readonly previousServerMs: number;
  /** Server clock now. The client's own timestamp is never used here. */
  readonly nowServerMs: number;
  readonly durationSeconds: number;
}

/**
 * Judges one report.
 *
 * Returns the coverage interval to record, or why it was refused. The
 * refusal is a value rather than an exception because a refused report is
 * ordinary traffic — a buggy client, a laggy network, or somebody probing —
 * and an endpoint that throws on ordinary traffic gets a catch block that
 * swallows real errors with it.
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
  // total-seconds check. `isFullyWatched` asks about gaps instead, so this
  // would not have worked — but a report that cannot be true should be
  // refused where it arrives rather than neutralised somewhere downstream.
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

  const elapsedSeconds = Math.max(0, (context.nowServerMs - context.previousServerMs) / 1_000);
  const claimedSeconds = report.toSeconds - report.fromSeconds;

  if (claimedSeconds > elapsedSeconds * MAX_PLAYBACK_RATE + TOLERANCE_SECONDS) {
    return {
      accepted: false,
      reason: { kind: "faster_than_realtime", claimedSeconds, elapsedSeconds },
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

  return { accepted: true, interval };
}

export function describeRefusal(refusal: ReportRefusal): string {
  switch (refusal.kind) {
    case "not_forward":
      return refusal.detail;
    case "faster_than_realtime":
      return (
        `Claimed ${String(refusal.claimedSeconds)}s of playback in ` +
        `${String(Math.round(refusal.elapsedSeconds))}s of real time. ` +
        `Impossible at ${String(MAX_PLAYBACK_RATE)}x, so it is refused rather than scored.`
      );
    case "beyond_duration":
      return `Reported position ${String(refusal.toSeconds)}s is past the campaign's ${String(refusal.durationSeconds)}s.`;
    case "sub_second":
      return refusal.detail;
  }
}
