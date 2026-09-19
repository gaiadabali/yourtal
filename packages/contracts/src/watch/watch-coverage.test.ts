import { describe, expect, it } from "vitest";
import {
  coverageFraction,
  coveredSeconds,
  isFullyWatched,
  mergeCoverage,
  toWholeSeconds,
  uncoveredGaps,
} from "./watch-coverage";
import { judgeProgressReport } from "./watch-progress-report";
import { judgeCompletion, watchSessionSchema } from "./watch-session";

/**
 * Coverage, and the attacks it exists to refuse. YT-0120, O-1, O-4.
 *
 * The scrub tests below are the point of the file. Risk 43 records a player
 * spec that asserted seeking to the end completes a campaign — written,
 * reviewed and committed, green only because Chrome declines to fire
 * `ended` on a seek. These assert the opposite, against the server rule that
 * does not depend on a browser choosing well.
 */

const DURATION = 1_800; // a 30-minute campaign

describe("merging what was watched", () => {
  it("joins overlapping spans", () => {
    expect(
      mergeCoverage([
        { fromSecond: 0, toSecond: 100 },
        { fromSecond: 50, toSecond: 150 },
      ]),
    ).toStrictEqual([{ fromSecond: 0, toSecond: 150 }]);
  });

  it("joins adjacent spans, so the count does not depend on report frequency", () => {
    // [0,10) and [10,20) describe continuous playback split across two
    // messages. Leaving them apart would make coverage a function of how
    // chatty the client happens to be.
    expect(
      mergeCoverage([
        { fromSecond: 0, toSecond: 10 },
        { fromSecond: 10, toSecond: 20 },
      ]),
    ).toStrictEqual([{ fromSecond: 0, toSecond: 20 }]);
  });

  it("keeps a genuine gap apart", () => {
    expect(
      mergeCoverage([
        { fromSecond: 0, toSecond: 10 },
        { fromSecond: 11, toSecond: 20 },
      ]),
    ).toHaveLength(2);
  });

  it("counts a rewatched second once", () => {
    expect(
      coveredSeconds([
        { fromSecond: 0, toSecond: 60 },
        { fromSecond: 0, toSecond: 60 },
        { fromSecond: 30, toSecond: 90 },
      ]),
    ).toBe(90);
  });

  it("sorts before merging, so out-of-order reports still combine", () => {
    // Reports arrive out of order all the time — a retried request, two
    // tabs, a slow network. Coverage must not depend on arrival order.
    expect(
      mergeCoverage([
        { fromSecond: 100, toSecond: 200 },
        { fromSecond: 0, toSecond: 100 },
      ]),
    ).toStrictEqual([{ fromSecond: 0, toSecond: 200 }]);
  });
});

describe("rounding a report into whole seconds", () => {
  it("rounds inward, never outward", () => {
    // Outward rounding would credit a second that was only partly played,
    // and 900 nudges would earn 900 seconds nobody watched.
    expect(toWholeSeconds(0.2, 9.9)).toStrictEqual({ fromSecond: 1, toSecond: 9 });
  });

  it("returns nothing when no whole second survives", () => {
    expect(toWholeSeconds(1.2, 1.9)).toBeNull();
    expect(toWholeSeconds(5, 5)).toBeNull();
  });

  it("refuses a negative position", () => {
    expect(toWholeSeconds(-10, 10)).toBeNull();
  });
});

describe("completion is coverage, not position", () => {
  it("is not complete after a scrub to the end", () => {
    // THE attack. A drag of the seek bar produces one short span at the end
    // and nothing in between. Under a position rule this is 100%; under a
    // coverage rule it is 10 seconds of a 1,800-second video.
    const scrub = [{ fromSecond: 1_790, toSecond: 1_800 }];
    expect(isFullyWatched(scrub, DURATION)).toBe(false);
    expect(coveredSeconds(scrub)).toBe(10);
  });

  it("is not complete when a single second in the middle is missing", () => {
    // Deliberately harsh, and correct under O-1: the rule is the full
    // length. A threshold would be a policy decision, and it belongs to the
    // founder rather than to a helper's default.
    const nearly = [
      { fromSecond: 0, toSecond: 900 },
      { fromSecond: 901, toSecond: DURATION },
    ];
    expect(isFullyWatched(nearly, DURATION)).toBe(false);
    expect(uncoveredGaps(nearly, DURATION)).toStrictEqual([{ fromSecond: 900, toSecond: 901 }]);
  });

  it("is complete when every second is covered, in any number of spans", () => {
    const watched = [
      { fromSecond: 0, toSecond: 600 },
      { fromSecond: 600, toSecond: 1_200 },
      { fromSecond: 1_200, toSecond: DURATION },
    ];
    expect(isFullyWatched(watched, DURATION)).toBe(true);
  });

  it("cannot be satisfied by claiming a span past the end", () => {
    // `isFullyWatched` asks what is MISSING rather than summing what was
    // claimed. A total-seconds comparison would have accepted this while
    // the middle of the video went unwatched.
    const inflated = [{ fromSecond: 0, toSecond: 10 }];
    expect(coveredSeconds([{ fromSecond: 0, toSecond: 999_999 }])).toBeGreaterThan(DURATION);
    expect(isFullyWatched(inflated, DURATION)).toBe(false);
  });

  it("reports a fraction clamped at one", () => {
    expect(coverageFraction([{ fromSecond: 0, toSecond: 900 }], DURATION)).toBe(0.5);
    expect(coverageFraction([{ fromSecond: 0, toSecond: 999_999 }], DURATION)).toBe(1);
  });

  it("is never complete for a zero-length campaign", () => {
    // Otherwise a malformed campaign pays everyone instantly.
    expect(isFullyWatched([{ fromSecond: 0, toSecond: 10 }], 0)).toBe(false);
  });
});

describe("a report has to be possible", () => {
  const base = {
    sessionId: "00000000-0000-4000-8000-00000000a001",
    reportedAt: "2026-09-20T00:00:00.000Z",
  };
  const context = {
    previousServerMs: 1_000_000,
    nowServerMs: 1_010_000,
    durationSeconds: DURATION,
  };

  it("accepts playback that fits in the elapsed time", () => {
    // 10 seconds claimed, 10 seconds of wall clock.
    const verdict = judgeProgressReport({ ...base, fromSeconds: 0, toSeconds: 10 }, context);
    expect(verdict.accepted).toBe(true);
  });

  it("refuses more playback than time has passed", () => {
    // You cannot watch 600 seconds in 10. This is the check that needs no
    // client cooperation: a scripted client POSTing as fast as it can is
    // stopped by the clock, not by a heuristic.
    const verdict = judgeProgressReport({ ...base, fromSeconds: 0, toSeconds: 600 }, context);
    expect(verdict.accepted).toBe(false);
    expect(!verdict.accepted ? verdict.reason.kind : "").toBe("faster_than_realtime");
  });

  it("allows a small tolerance for batching and clock skew", () => {
    // 12s claimed in a 10s window is ordinary. The tolerance is absolute,
    // not a percentage — a percentage grows with the size of the lie.
    const verdict = judgeProgressReport({ ...base, fromSeconds: 0, toSeconds: 12 }, context);
    expect(verdict.accepted).toBe(true);
  });

  it("refuses a position past the end of the campaign", () => {
    const verdict = judgeProgressReport({ ...base, fromSeconds: 0, toSeconds: 9_999 }, context);
    expect(!verdict.accepted ? verdict.reason.kind : "").toBe("beyond_duration");
  });

  it("refuses a span that does not move forwards", () => {
    const verdict = judgeProgressReport({ ...base, fromSeconds: 100, toSeconds: 100 }, context);
    expect(!verdict.accepted ? verdict.reason.kind : "").toBe("not_forward");
  });

  it("ACCEPTS a seek, because seeking is allowed and simply earns nothing", () => {
    // A jump forward reports a span beginning past the last position. It is
    // legitimate — blocking seeks would be a worse product for no security
    // gain, since the skipped seconds are never covered anyway.
    const verdict = judgeProgressReport({ ...base, fromSeconds: 1_700, toSeconds: 1_705 }, context);
    expect(verdict.accepted).toBe(true);
    // And what it earns is five seconds, not completion.
    expect(verdict.accepted ? coveredSeconds([verdict.interval]) : 0).toBe(5);
  });
});

describe("judging a completed session", () => {
  const session = watchSessionSchema.parse({
    id: "00000000-0000-4000-8000-00000000a001",
    userId: "00000000-0000-4000-8000-00000000b001",
    campaignId: "00000000-0000-4000-8000-00000000c001",
    termsVersion: 1,
    state: "active",
    startedAt: "2026-09-20T00:00:00.000Z",
    lastProgressAt: "2026-09-20T00:30:00.000Z",
    completedAt: null,
  });
  const fullCoverage = [{ fromSecond: 0, toSecond: DURATION }];

  it("earns when the video is fully watched and the questions are answered", () => {
    expect(
      judgeCompletion({
        session,
        coverage: fullCoverage,
        durationSeconds: DURATION,
        questionsAnswered: true,
        campaignIsLive: true,
      }),
    ).toBe("earned");
  });

  it("refuses a scrubbed session even with the questions answered", () => {
    // Both halves of O-1 are required and the coverage half cannot be
    // bought with the other.
    const refusal = judgeCompletion({
      session,
      coverage: [{ fromSecond: 1_790, toSecond: DURATION }],
      durationSeconds: DURATION,
      questionsAnswered: true,
      campaignIsLive: true,
    });
    expect(refusal).toMatchObject({ kind: "coverage_incomplete", uncoveredSeconds: 1_790 });
  });

  it("refuses a fully watched session with the questions unanswered", () => {
    expect(
      judgeCompletion({
        session,
        coverage: fullCoverage,
        durationSeconds: DURATION,
        questionsAnswered: false,
        campaignIsLive: true,
      }),
    ).toMatchObject({ kind: "questions_unanswered" });
  });

  it("reports coverage before questions, because only one is actionable", () => {
    // "47 seconds left" tells a viewer what to do. "Answer the questions"
    // does not, when the questions are not offered until the video is done.
    const refusal = judgeCompletion({
      session,
      coverage: [{ fromSecond: 0, toSecond: 1_753 }],
      durationSeconds: DURATION,
      questionsAnswered: false,
      campaignIsLive: true,
    });
    expect(refusal).toMatchObject({ kind: "coverage_incomplete", uncoveredSeconds: 47 });
  });

  it("refuses when the campaign is no longer live", () => {
    expect(
      judgeCompletion({
        session,
        coverage: fullCoverage,
        durationSeconds: DURATION,
        questionsAnswered: true,
        campaignIsLive: false,
      }),
    ).toMatchObject({ kind: "campaign_not_live" });
  });

  it.each(["completed", "superseded", "void"] as const)("refuses a %s session", (state) => {
    expect(
      judgeCompletion({
        session: { ...session, state },
        coverage: fullCoverage,
        durationSeconds: DURATION,
        questionsAnswered: true,
        campaignIsLive: true,
      }),
    ).toMatchObject({ kind: "not_active", state });
  });
});
