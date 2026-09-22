import { describe, expect, it } from "vitest";
import {
  type DeliverySchedule,
  type PacingState,
  applySpend,
  availableTokens,
  bucketCapacity,
  canServe,
  intervalCount,
  maxOverspendPoints,
  refillPerInterval,
} from "./campaign-pacing";

const HOUR = 60 * 60 * 1000;
const START = Date.UTC(2026, 8, 22, 0, 0, 0);

/** 24,000 points over 24 hourly intervals — 1,000 per hour. */
const SCHEDULE: DeliverySchedule = {
  totalPoints: 24_000,
  startAtMs: START,
  endAtMs: START + 24 * HOUR,
  intervalMs: HOUR,
};

function stateAt(tokens: number, atMs: number): PacingState {
  return { tokens, lastRefillAtMs: atMs };
}

describe("schedule arithmetic", () => {
  it("divides the flight into whole intervals", () => {
    expect(intervalCount(SCHEDULE)).toBe(24);
    expect(refillPerInterval(SCHEDULE)).toBe(1_000);
  });

  it("never divides by zero on a degenerate schedule", () => {
    const instant: DeliverySchedule = { ...SCHEDULE, endAtMs: START };
    expect(intervalCount(instant)).toBe(1);
    expect(refillPerInterval(instant)).toBe(24_000);
  });

  /**
   * Rounding is deliberately absent. Flooring would strand points across a
   * long flight; ceiling would release more than the campaign was funded
   * for and push the problem onto the ledger's refusal.
   */
  it("keeps the fractional remainder rather than rounding it away", () => {
    const awkward: DeliverySchedule = {
      ...SCHEDULE,
      totalPoints: 10_000,
      endAtMs: START + 3 * HOUR,
    };
    expect(refillPerInterval(awkward)).toBeCloseTo(3_333.333, 2);
    // The whole funded amount is still accounted for.
    expect(refillPerInterval(awkward) * intervalCount(awkward)).toBeCloseTo(10_000, 6);
  });
});

describe("refill is derived, not applied", () => {
  it("accrues tokens as time passes without anyone writing", () => {
    const state = stateAt(0, START);

    expect(availableTokens(state, SCHEDULE, START)).toBe(0);
    expect(availableTokens(state, SCHEDULE, START + HOUR)).toBe(1_000);
  });

  it("ignores a partial interval — accrual is per whole interval", () => {
    const state = stateAt(0, START);
    expect(availableTokens(state, SCHEDULE, START + HOUR - 1)).toBe(0);
  });

  /**
   * The clamp that makes an idle campaign safe. Without it, a campaign that
   * served nothing for a day would hold 24,000 tokens and dump the entire
   * flight's budget into whoever arrived next.
   */
  it("clamps to one interval's refill, so idleness does not compound into a burst", () => {
    const idle = stateAt(0, START);
    expect(availableTokens(idle, SCHEDULE, START + 24 * HOUR)).toBe(1_000);
    expect(availableTokens(idle, SCHEDULE, START + 240 * HOUR)).toBe(1_000);
  });

  it("does not go backwards when the clock does", () => {
    const state = stateAt(500, START);
    // A clock skewed backwards must not produce negative accrual.
    expect(availableTokens(state, SCHEDULE, START - 5 * HOUR)).toBe(500);
  });

  /** Read-only on the serving path, asserted rather than asserted-in-prose. */
  it("mutates neither the state nor the schedule", () => {
    const state = Object.freeze(stateAt(250, START));
    const schedule = Object.freeze({ ...SCHEDULE });

    expect(() => availableTokens(state, schedule, START + 3 * HOUR)).not.toThrow();
    expect(() => canServe(state, schedule, START + 3 * HOUR, 100)).not.toThrow();
    expect(state.tokens).toBe(250);
    expect(state.lastRefillAtMs).toBe(START);
  });
});

describe("canServe", () => {
  it("permits a spend that fits", () => {
    const verdict = canServe(stateAt(1_000, START), SCHEDULE, START, 250);
    expect(verdict.allowed).toBe(true);
    expect(verdict.available).toBe(1_000);
  });

  it("refuses a spend that does not, and says when to come back", () => {
    const verdict = canServe(stateAt(100, START), SCHEDULE, START, 600);

    expect(verdict.allowed).toBe(false);
    expect(verdict.available).toBe(100);
    expect(verdict.retryAtMs).toBe(START + HOUR);
  });

  /**
   * "Wait" and "never" must be distinguishable. A cost larger than the
   * bucket can ever hold is not affordable however long anyone waits, and
   * returning a far-future retry time would turn that into a retry loop
   * that never terminates.
   */
  it("omits retryAtMs when waiting cannot possibly help", () => {
    const verdict = canServe(stateAt(0, START), SCHEDULE, START, 5_000);

    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAtMs).toBeUndefined();
    expect(5_000).toBeGreaterThan(bucketCapacity(SCHEDULE));
  });

  it("gives a retry time that is actually sufficient", () => {
    const state = stateAt(0, START);
    const cost = 900;
    const verdict = canServe(state, SCHEDULE, START, cost);

    expect(verdict.allowed).toBe(false);
    const retryAt = verdict.retryAtMs ?? Number.NaN;
    // The promise has to hold when the caller comes back.
    expect(canServe(state, SCHEDULE, retryAt, cost).allowed).toBe(true);
  });
});

describe("overspend is bounded by one refill interval", () => {
  it("states the bound as a number a test can pin", () => {
    expect(maxOverspendPoints(SCHEDULE)).toBe(1_000);
    expect(maxOverspendPoints(SCHEDULE)).toBe(refillPerInterval(SCHEDULE));
  });

  /**
   * The NEGATIVE result, asserted so nobody re-derives the false version.
   *
   * A read-only serving path cannot bound concurrent overspend on its own.
   * Twenty servers evaluating the same snapshot before any spend has
   * settled all see a full bucket and all say yes. This test exists to
   * record that, because the intuitive reading of the criterion is that
   * the bucket prevents it, and it does not.
   */
  it("does NOT bound an uncoordinated stampede against one stale snapshot", () => {
    const snapshot = stateAt(bucketCapacity(SCHEDULE), START);
    const cost = 100;

    let admitted = 0;
    for (let i = 0; i < 20; i += 1) {
      if (canServe(snapshot, SCHEDULE, START, cost).allowed) admitted += cost;
    }

    expect(admitted).toBe(2_000);
    expect(admitted).toBeGreaterThan(maxOverspendPoints(SCHEDULE));
  });

  /**
   * The bound that IS real: across accounting cycles, given the caller
   * refreshes its snapshot each interval.
   *
   * Each cycle overspends wildly against a stale snapshot, then settles.
   * The debt carries into the next cycle instead of being forgiven, so
   * cumulative spend tracks the schedule rather than running away from it.
   * That is what "bounded by one refill interval" can honestly mean.
   */
  it("bounds cumulative overspend to one interval when state is refreshed each interval", () => {
    let state = stateAt(bucketCapacity(SCHEDULE), START);
    let cumulativeSpend = 0;

    for (let cycle = 0; cycle < 12; cycle += 1) {
      const nowMs = START + cycle * HOUR;
      const available = availableTokens(state, SCHEDULE, nowMs);

      // A stampede: everything available goes at once, plus an extra
      // in-flight serve that settles before the snapshot refreshes.
      const spentThisCycle = Math.max(0, available) + 250;
      cumulativeSpend += spentThisCycle;
      state = applySpend(state, SCHEDULE, spentThisCycle, nowMs);
    }

    const scheduled = 12 * refillPerInterval(SCHEDULE) + bucketCapacity(SCHEDULE);
    expect(cumulativeSpend).toBeGreaterThan(scheduled - maxOverspendPoints(SCHEDULE));
    expect(cumulativeSpend).toBeLessThanOrEqual(scheduled + maxOverspendPoints(SCHEDULE));
  });

  /**
   * The mechanism behind that bound: debt carries. Clamping the floor at
   * zero would forgive the overspend and let each cycle start full.
   */
  it("carries overspend as debt rather than forgiving it", () => {
    const state = stateAt(1_000, START);
    const overspent = applySpend(state, SCHEDULE, 1_600, START);

    expect(overspent.tokens).toBe(-600);
    // The next interval's refill repays the debt first.
    expect(availableTokens(overspent, SCHEDULE, START + HOUR)).toBe(400);
  });

  it("does not widen for a longer flight at the same interval", () => {
    const year: DeliverySchedule = {
      totalPoints: 24_000 * 365,
      startAtMs: START,
      endAtMs: START + 365 * 24 * HOUR,
      intervalMs: HOUR,
    };

    expect(maxOverspendPoints(year)).toBe(maxOverspendPoints(SCHEDULE));
  });
});
