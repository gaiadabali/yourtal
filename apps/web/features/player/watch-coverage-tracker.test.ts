import { describe, expect, it } from "vitest";
import type { CoverageInterval } from "@yourtal/contracts/watch/coverage";
import { applyCoverageTick, hasFullRealCoverage } from "./watch-coverage-tracker";

/**
 * YT-0551. Per docs/13-engineering-standards.md §4 and the incident log:
 * "prove a check by breaking what it is meant to catch, then confirm the
 * break actually reached the code." The two `describe` blocks below named
 * "the attack" are exactly that — each encodes one of the fraud paths named
 * in the ticket and asserts completion does NOT happen.
 */
describe("applyCoverageTick", () => {
  it("credits a forward tick that does not follow a seek", () => {
    const coverage = applyCoverageTick([], {
      previousRealSeconds: 0,
      currentRealSeconds: 5,
      followsSeek: false,
    });
    expect(coverage).toEqual([{ fromSecond: 0, toSecond: 5 }]);
  });

  it("refuses a tick that follows a seek, regardless of direction or size", () => {
    const coverage = applyCoverageTick([], {
      previousRealSeconds: 0,
      currentRealSeconds: 30,
      followsSeek: true,
    });
    expect(coverage).toEqual([]);
  });

  it("refuses a non-forward tick (rewind reported as its own span, not a negative one)", () => {
    const coverage = applyCoverageTick([{ fromSecond: 0, toSecond: 10 }], {
      previousRealSeconds: 10,
      currentRealSeconds: 4,
      followsSeek: false,
    });
    expect(coverage).toEqual([{ fromSecond: 0, toSecond: 10 }]);
  });

  it("merges consecutive genuine ticks into one continuous span", () => {
    let coverage: readonly CoverageInterval[] = [];
    coverage = applyCoverageTick(coverage, {
      previousRealSeconds: 0,
      currentRealSeconds: 4,
      followsSeek: false,
    });
    coverage = applyCoverageTick(coverage, {
      previousRealSeconds: 4,
      currentRealSeconds: 8,
      followsSeek: false,
    });
    expect(coverage).toEqual([{ fromSecond: 0, toSecond: 8 }]);
  });

  it("re-credits after a seek resets the pointer, so rewatching still earns", () => {
    let coverage: readonly CoverageInterval[] = [{ fromSecond: 0, toSecond: 10 }];
    // User drags back to 2s (a seek — refused), then plays forward again.
    coverage = applyCoverageTick(coverage, {
      previousRealSeconds: 10,
      currentRealSeconds: 2,
      followsSeek: true,
    });
    coverage = applyCoverageTick(coverage, {
      previousRealSeconds: 2,
      currentRealSeconds: 12,
      followsSeek: false,
    });
    expect(coverage).toEqual([{ fromSecond: 0, toSecond: 12 }]);
  });
});

describe("hasFullRealCoverage", () => {
  it("is false with no coverage at all", () => {
    expect(hasFullRealCoverage([], 20)).toBe(false);
  });

  it("is false against a zero or negative duration", () => {
    expect(hasFullRealCoverage([{ fromSecond: 0, toSecond: 20 }], 0)).toBe(false);
  });

  it("is true once every second of the duration is covered", () => {
    expect(hasFullRealCoverage([{ fromSecond: 0, toSecond: 20 }], 20)).toBe(true);
  });

  it("forgives only a small tail gap, matching a real element's last-tick rounding", () => {
    expect(hasFullRealCoverage([{ fromSecond: 0, toSecond: 19.8 }], 20)).toBe(true);
  });

  it("refuses a tail gap larger than the tolerance", () => {
    expect(hasFullRealCoverage([{ fromSecond: 0, toSecond: 17 }], 20)).toBe(false);
  });

  it("refuses a small gap that is NOT at the tail — tolerance is positional, not just size-based", () => {
    expect(
      hasFullRealCoverage(
        [
          { fromSecond: 0, toSecond: 9.9 },
          { fromSecond: 10, toSecond: 20 },
        ],
        20,
      ),
    ).toBe(false);
  });

  it("refuses more than one gap even if each is individually within tolerance", () => {
    expect(
      hasFullRealCoverage(
        [
          { fromSecond: 0, toSecond: 5 },
          { fromSecond: 5.2, toSecond: 19.9 },
        ],
        20,
      ),
    ).toBe(false);
  });

  describe("the attack: a single scrub straight to the end", () => {
    it("does not report full coverage", () => {
      // Exactly the risk-43 shape: one report/tick spanning the whole
      // timeline in one jump, with nothing watched on the way.
      const coverage = applyCoverageTick([], {
        previousRealSeconds: 0,
        currentRealSeconds: 20,
        followsSeek: true,
      });
      expect(coverage).toEqual([]);
      expect(hasFullRealCoverage(coverage, 20)).toBe(false);
    });

    it("does not report full coverage even if the scrub is reported as many small seeks", () => {
      // A drag fires many onChange events, but every one of them is a
      // seek — followsSeek is true for the whole gesture, not just the
      // first step. Coalescing into "many small jumps" must not create an
      // opening a single big jump does not have.
      let coverage: readonly CoverageInterval[] = [];
      let position = 0;
      for (let step = 0; step < 40; step += 1) {
        const next = position + 0.5;
        coverage = applyCoverageTick(coverage, {
          previousRealSeconds: position,
          currentRealSeconds: next,
          followsSeek: true,
        });
        position = next;
      }
      expect(coverage).toEqual([]);
      expect(hasFullRealCoverage(coverage, 20)).toBe(false);
    });
  });

  describe("the attack: a synthetic `ended` event with no real playback", () => {
    it("reports incomplete when the coverage backing it is empty", () => {
      // `video.dispatchEvent(new Event("ended"))` from a console changes
      // nothing this module tracks — there is no tick, so there is no
      // coverage. use-watch-session.ts asks this same question on `ended`
      // rather than trusting the event, which is the fix this test pins.
      expect(hasFullRealCoverage([], 20)).toBe(false);
    });

    it("reports incomplete when only the middle was skipped past", () => {
      const coverage: CoverageInterval[] = [
        { fromSecond: 0, toSecond: 3 },
        { fromSecond: 18, toSecond: 20 },
      ];
      expect(hasFullRealCoverage(coverage, 20)).toBe(false);
    });
  });
});
