import { describe, expect, it } from "vitest";
import { assessRewardToDataCost, describeRewardDataCostRatio } from "./campaign-reward-risk";

describe("assessRewardToDataCost", () => {
  it("flags a trivially small reward against a long, data-heavy video (the risk register's insulting-ratio case)", () => {
    // 30 min -> 180 MB (docs/06's own table) -> IDR 720 of data.
    // A reward of 100 points -> IDR 600, well under the IDR 15,000 docs/06 says is needed.
    const assessment = assessRewardToDataCost(100, 180, "IDR");
    expect(assessment.meetsGuideline).toBe(false);
    expect(assessment.ratio).toBeLessThan(20);
  });

  it("passes a reward that dwarfs the data cost, per docs/06's own worked example", () => {
    // 180 MB * 4 IDR/MB = 720 IDR data cost. A reward worth >= 15,000 IDR clears the 20x bar.
    // 15,000 / 6 IDR-per-point = 2,500 points.
    const assessment = assessRewardToDataCost(2_500, 180, "IDR");
    expect(assessment.meetsGuideline).toBe(true);
    expect(assessment.ratio).toBeGreaterThanOrEqual(20);
  });

  it("treats zero data cost as always meeting the guideline rather than dividing by zero", () => {
    const assessment = assessRewardToDataCost(50, 0, "IDR");
    expect(assessment.meetsGuideline).toBe(true);
    expect(Number.isFinite(assessment.ratio)).toBe(false);
  });

  it("computes independently for AUD without mixing currencies", () => {
    const assessment = assessRewardToDataCost(500, 30, "AUD");
    expect(assessment.dataCostMinorUnits).toBeGreaterThan(0);
    expect(assessment.rewardValueMinorUnits).toBe(500 * 3);
  });
});

describe("describeRewardDataCostRatio", () => {
  it("names the actual ratio in a failing message, not just pass/fail", () => {
    const assessment = assessRewardToDataCost(100, 180, "IDR");
    const message = describeRewardDataCostRatio(assessment);
    expect(message).toContain("below the platform's 20x guideline");
  });

  it("confirms the guideline is met in a passing message", () => {
    const assessment = assessRewardToDataCost(2_500, 180, "IDR");
    const message = describeRewardDataCostRatio(assessment);
    expect(message).toContain("at or above the platform's 20x guideline");
  });
});
