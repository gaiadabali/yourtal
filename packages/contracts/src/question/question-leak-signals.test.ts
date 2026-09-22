import { describe, expect, it } from "vitest";
import {
  LEAK_ACCURACY_JUMP,
  MIN_WINDOW_ANSWERS,
  type AnswerPattern,
  describeRetirement,
  identicalAnswerCohorts,
  judgeAccuracyJump,
} from "./question-leak-signals";

/**
 * A window with EXACTLY the stated accuracy.
 *
 * Asserts rather than rounds: `Math.round(50 * 0.97)` is 49, which is 98%,
 * so a 50-answer window silently cannot express 97% and a test naming that
 * figure would be asserting against a number the fixture never produced.
 * Caught by a display assertion disagreeing with its own input.
 */
const window = (answered: number, accuracy: number) => {
  const correct = answered * accuracy;
  if (!Number.isInteger(correct)) {
    throw new Error(
      `${String(answered)} answers cannot express ${String(accuracy)} exactly — pick a window size that can`,
    );
  }
  return { answered, correct };
};

describe("accuracy jump", () => {
  it("catches docs/18 §11's worked example: 61% to 97% overnight", () => {
    const verdict = judgeAccuracyJump(window(200, 0.61), window(100, 0.97));

    expect(verdict.leaked).toBe(true);
    if (verdict.leaked) {
      expect(verdict.jump).toBeGreaterThan(0.3);
    }
  });

  it("says nothing about a question whose accuracy is merely high", () => {
    // An easy question is not a leaked one. The signal is the CHANGE, so a
    // question that has always been answered well must never be retired
    // for being easy — that would delete the bank's best content.
    expect(judgeAccuracyJump(window(200, 0.94), window(100, 0.96)).leaked).toBe(false);
  });

  it("says nothing about ordinary drift", () => {
    expect(judgeAccuracyJump(window(200, 0.61), window(100, 0.7)).leaked).toBe(false);
  });

  /**
   * The most dangerous version of this detector is one that fires on small
   * numbers. Three lucky viewers in an hour look exactly like a leak, and a
   * rule that retires on that evidence hands anybody a way to delete a
   * campaign's bank by answering it well a few times.
   */
  it("refuses to judge a window too small to mean anything", () => {
    const tiny = judgeAccuracyJump({ answered: MIN_WINDOW_ANSWERS - 1, correct: 4 }, window(200, 1));
    expect(tiny).toEqual({ leaked: false, reason: "insufficient_data" });

    const tinyRecent = judgeAccuracyJump(window(200, 0.2), window(MIN_WINDOW_ANSWERS - 1, 1));
    expect(tinyRecent).toEqual({ leaked: false, reason: "insufficient_data" });
  });

  it("judges once both windows reach the floor", () => {
    const verdict = judgeAccuracyJump(
      window(MIN_WINDOW_ANSWERS, 0.3),
      window(MIN_WINDOW_ANSWERS, 0.95),
    );
    expect(verdict.leaked).toBe(true);
  });

  it("is exclusive at the threshold, so exactly-at-the-jump does not fire", () => {
    const below = judgeAccuracyJump(window(100, 0.5), window(100, 0.5 + LEAK_ACCURACY_JUMP - 0.01));
    expect(below.leaked).toBe(false);
    const at = judgeAccuracyJump(window(100, 0.5), window(100, 0.5 + LEAK_ACCURACY_JUMP));
    expect(at.leaked).toBe(true);
  });

  it("never treats a DROP in accuracy as a leak", () => {
    // A question that got harder, or a cohort that got worse, is not a
    // leak. Without a signed comparison an absolute difference would
    // retire questions for the opposite of the reason this exists.
    expect(judgeAccuracyJump(window(200, 0.95), window(100, 0.2)).leaked).toBe(false);
  });

  it("states the numbers in the retirement reason, not just the conclusion", () => {
    const verdict = judgeAccuracyJump(window(200, 0.61), window(100, 0.97));
    expect(verdict.leaked).toBe(true);
    if (!verdict.leaked) return;

    const reason = describeRetirement(verdict);
    expect(reason).toContain("61%");
    expect(reason).toContain("97%");
    // The cohort is flagged, never actioned — docs/18 §11.
    expect(reason).toContain("not actioned");
  });
});

describe("answer-pattern cohorts", () => {
  const pattern = (accountId: string, answers: Record<string, string>): AnswerPattern => ({
    accountId,
    answers: new Map(Object.entries(answers)),
  });

  it("groups accounts that answered an identical subset identically", () => {
    const cohorts = identicalAnswerCohorts([
      pattern("a", { q1: "opt1", q2: "opt3" }),
      pattern("b", { q2: "opt3", q1: "opt1" }),
      pattern("c", { q1: "opt2", q2: "opt3" }),
    ]);

    expect(cohorts).toHaveLength(1);
    expect(cohorts[0]?.accountIds).toEqual(["a", "b"]);
    expect(cohorts[0]?.questionIds).toEqual(["q1", "q2"]);
  });

  it("is insensitive to the order answers were recorded in", () => {
    // `a` and `b` above supplied the same pairs in different insertion
    // order. If the fingerprint depended on that, two colluding accounts
    // would evade grouping by answering in a different sequence.
    const cohorts = identicalAnswerCohorts([
      pattern("a", { q9: "x", q1: "y" }),
      pattern("b", { q1: "y", q9: "x" }),
    ]);
    expect(cohorts[0]?.accountIds).toEqual(["a", "b"]);
  });

  it("does not group accounts that merely saw the same questions", () => {
    // Matching on the served subset alone would group honest viewers who
    // happened to draw the same questions and disagreed. The answers are
    // what make it a cohort.
    const cohorts = identicalAnswerCohorts([
      pattern("a", { q1: "opt1" }),
      pattern("b", { q1: "opt2" }),
    ]);
    expect(cohorts).toEqual([]);
  });

  it("does not group accounts that agreed on a subset but saw different questions", () => {
    const cohorts = identicalAnswerCohorts([
      pattern("a", { q1: "opt1" }),
      pattern("b", { q1: "opt1", q2: "opt4" }),
    ]);
    expect(cohorts).toEqual([]);
  });

  it("returns no singletons — every honest viewer is one", () => {
    const cohorts = identicalAnswerCohorts([
      pattern("a", { q1: "opt1" }),
      pattern("b", { q2: "opt2" }),
      pattern("c", { q3: "opt3" }),
    ]);
    expect(cohorts).toEqual([]);
  });

  it("excludes accounts that answered nothing rather than grouping them together", () => {
    // They all trivially share the empty subset. A cohort of everyone who
    // has answered nothing is an artefact of the grouping, not a finding.
    const cohorts = identicalAnswerCohorts([
      pattern("a", {}),
      pattern("b", {}),
      pattern("c", {}),
    ]);
    expect(cohorts).toEqual([]);
  });

  it("separates two distinct colluding groups rather than merging them", () => {
    const cohorts = identicalAnswerCohorts([
      pattern("a", { q1: "opt1" }),
      pattern("b", { q1: "opt1" }),
      pattern("c", { q2: "opt7" }),
      pattern("d", { q2: "opt7" }),
    ]);
    expect(cohorts).toHaveLength(2);
    expect(cohorts.map((cohort) => cohort.accountIds)).toEqual(
      expect.arrayContaining([
        ["a", "b"],
        ["c", "d"],
      ]),
    );
  });
});
