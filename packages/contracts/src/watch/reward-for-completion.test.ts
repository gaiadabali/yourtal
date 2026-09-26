import { describe, expect, it } from "vitest";
import { pointsForCompletion } from "./reward-for-completion";

describe("pointsForCompletion", () => {
  it("pays only the base under base_only, whatever the score", () => {
    const terms = { rewardPoints: 500, accuracyBonusPoints: 200, scoringRule: "base_only" as const };
    expect(pointsForCompletion(terms, 3, 3)).toBe(500);
    expect(pointsForCompletion(terms, 3, 0)).toBe(500);
  });

  it("pays the bonus only on a perfect score under base_plus_accuracy_bonus", () => {
    const terms = {
      rewardPoints: 500,
      accuracyBonusPoints: 200,
      scoringRule: "base_plus_accuracy_bonus" as const,
    };
    expect(pointsForCompletion(terms, 3, 3)).toBe(700);
    expect(pointsForCompletion(terms, 3, 2)).toBe(500);
  });

  it("a Quick campaign with no questions still gets its base under either rule", () => {
    const terms = { rewardPoints: 150, accuracyBonusPoints: 0, scoringRule: "base_only" as const };
    expect(pointsForCompletion(terms, 0, 0)).toBe(150);
  });
});
