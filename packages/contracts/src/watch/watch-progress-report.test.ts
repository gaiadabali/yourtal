import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { coveredSeconds } from "./watch-coverage";
import type { CoverageInterval } from "./watch-coverage";
import {
  TOLERANCE_SECONDS,
  describeRefusal,
  judgeProgressReport,
  type ReportContext,
} from "./watch-progress-report";

const DURATION = 1_800;

function context(overrides: Partial<ReportContext> = {}): ReportContext {
  return {
    startedAtMs: 0,
    nowServerMs: 0,
    durationSeconds: DURATION,
    existingCoverage: [],
    ...overrides,
  };
}

function report(fromSeconds: number, toSeconds: number) {
  return {
    sessionId: randomUUID(),
    fromSeconds,
    toSeconds,
    reportedAt: new Date().toISOString(),
  };
}

describe("judgeProgressReport: basic shape checks", () => {
  it("refuses a span that does not move forward", () => {
    const verdict = judgeProgressReport(report(10, 10), context());
    expect(verdict.accepted).toBe(false);
  });

  it("refuses a position past the campaign's duration", () => {
    const verdict = judgeProgressReport(report(0, DURATION + 1), context({ nowServerMs: 5_000 }));
    expect(verdict).toMatchObject({ accepted: false, reason: { kind: "beyond_duration" } });
  });

  it("refuses a span with no whole second in it", () => {
    const verdict = judgeProgressReport(report(1.2, 1.6), context({ nowServerMs: 5_000 }));
    expect(verdict).toMatchObject({ accepted: false, reason: { kind: "sub_second" } });
  });

  it("accepts a span that fits inside elapsed time plus the one-time tolerance", () => {
    const verdict = judgeProgressReport(report(0, 2), context({ nowServerMs: 0 }));
    expect(verdict).toMatchObject({ accepted: true, interval: { fromSecond: 0, toSecond: 2 } });
  });
});

describe("judgeProgressReport: EW-01, the cumulative budget", () => {
  it("REFUSES a single report claiming far more than has elapsed", () => {
    // Fresh session, no time passed at all: nothing beyond the tolerance can
    // be claimed.
    const verdict = judgeProgressReport(report(0, DURATION), context({ nowServerMs: 0 }));
    expect(verdict).toMatchObject({ accepted: false, reason: { kind: "faster_than_realtime" } });
  });

  it("the burst attack: 600 reports in simulated 3s of wall clock cover at most elapsed + one tolerance", () => {
    // Reproduces docs/audit/2026-09-25/engine-watch.md's probe: a scripted
    // client posting progress as fast as it can, each report claiming a 3s
    // span, faster than any real player could move. Under the OLD per-report
    // tolerance this covered the whole 1,800s campaign; the cumulative
    // budget must hold it to (elapsed + TOLERANCE_SECONDS) regardless of how
    // many reports arrive.
    const startedAtMs = 0;
    const wallClockMs = 3_000; // the whole burst happens inside 3 real seconds
    let coverage: CoverageInterval[] = [];
    let accepted = 0;

    for (let index = 0; index < 600; index += 1) {
      // Reports land evenly across the 3s window, each claiming 3 NEW
      // seconds starting where the last claim ended — the shape a farmer
      // wants: maximum claimed seconds, minimum real time.
      const nowServerMs = startedAtMs + Math.floor((index / 600) * wallClockMs);
      const from = index * 3;
      const to = from + 3;
      if (to > DURATION) break;

      const verdict = judgeProgressReport(
        report(from, to),
        context({ startedAtMs, nowServerMs, existingCoverage: coverage }),
      );
      if (verdict.accepted) {
        coverage = [...coverage, verdict.interval];
        accepted += 1;
      }
    }

    const totalCovered = coveredSeconds(coverage);
    // The whole point: nowhere near the campaign's 1,800s.
    expect(totalCovered).toBeLessThanOrEqual(wallClockMs / 1_000 + TOLERANCE_SECONDS);
    expect(totalCovered).toBeLessThan(10);
    // Some reports are accepted (the ones that fit the budget); most are not.
    expect(accepted).toBeGreaterThan(0);
    expect(accepted).toBeLessThan(600);
  });

  it("the idle-then-claim attack: sleeping N seconds does not license a span of N + TOLERANCE + 1", () => {
    const startedAtMs = 0;
    const idleSeconds = 90;
    const verdict = judgeProgressReport(
      report(0, idleSeconds + TOLERANCE_SECONDS + 1),
      context({ startedAtMs, nowServerMs: idleSeconds * 1_000 }),
    );
    expect(verdict.accepted).toBe(false);
  });

  it("an honest idle-then-resume claim of exactly what elapsed is accepted", () => {
    const startedAtMs = 0;
    const idleSeconds = 90;
    const verdict = judgeProgressReport(
      report(0, idleSeconds),
      context({ startedAtMs, nowServerMs: idleSeconds * 1_000 }),
    );
    expect(verdict.accepted).toBe(true);
  });

  it("the parallel-report attack: two overlapping claims judged against the SAME base do not double the budget", () => {
    // This is the arithmetic half of EW-01's parallel-report hole; the other
    // half (that the two must not even be judged concurrently against the
    // same base) is the row lock in DrizzleWatchSessionRepository.recordProgress,
    // proved by that repository's own test. Here: even if both requests
    // somehow judged against the same starting coverage, the SECOND one to
    // actually be recorded must merge against what the FIRST one added, not
    // against a stale view — which is what this asserts by re-deriving
    // coverage sequentially rather than from two independent empty bases.
    const startedAtMs = 0;
    const nowServerMs = 60_000; // one real minute has passed
    let coverage: CoverageInterval[] = [];

    const first = judgeProgressReport(
      report(0, 60),
      context({ startedAtMs, nowServerMs, existingCoverage: coverage }),
    );
    expect(first.accepted).toBe(true);
    if (first.accepted) coverage = [...coverage, first.interval];

    // A second request claiming the SAME 60s span again, arriving right
    // after — the "two parallel requests both read the same state" shape.
    // It must add nothing (already covered), never double-count.
    const second = judgeProgressReport(
      report(0, 60),
      context({ startedAtMs, nowServerMs, existingCoverage: coverage }),
    );
    expect(second.accepted).toBe(true);
    if (second.accepted) coverage = [...coverage, second.interval];

    expect(coveredSeconds(coverage)).toBe(60);

    // A THIRD request claiming another fresh 60s on top of the honest 60
    // already recorded must be refused: only 60s of real time has passed.
    const third = judgeProgressReport(
      report(60, 120),
      context({ startedAtMs, nowServerMs, existingCoverage: coverage }),
    );
    expect(third.accepted).toBe(false);
  });

  it("describeRefusal names the cumulative total, not a per-report claim", () => {
    const verdict = judgeProgressReport(report(0, DURATION), context({ nowServerMs: 0 }));
    expect(verdict.accepted).toBe(false);
    if (!verdict.accepted) {
      expect(describeRefusal(verdict.reason)).toMatch(/credited playback/);
    }
  });
});
