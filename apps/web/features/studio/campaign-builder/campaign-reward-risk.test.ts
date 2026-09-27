import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import enAU from "@/messages/en-AU/studio.json";
import { assessRewardToDataCost, describeRewardDataCostRatio } from "./campaign-reward-risk";

// A plain, non-React translator for this pure-logic test — see
// `studio-test-i18n.tsx` for the RTL-render equivalent.
const t = createTranslator({ locale: "en-AU", messages: { studio: enAU }, namespace: "studio" });

describe("assessRewardToDataCost", () => {
  it("flags a trivially small reward against a long, data-heavy video (the risk register's insulting-ratio case)", () => {
    // 30 min -> 180 MB -> IDR 720 of data. A reward worth IDR 600 is well under the IDR 15,000 needed.
    const assessment = assessRewardToDataCost(600, 180, "IDR");
    expect(assessment.meetsGuideline).toBe(false);
    expect(assessment.ratio).toBeLessThan(20);
  });

  it("passes a reward that dwarfs the data cost, per the risk register's own worked example", () => {
    // 180 MB * 4 IDR/MB = 720 IDR data cost. A reward worth >= 15,000 IDR clears the 20x bar.
    const assessment = assessRewardToDataCost(15_000, 180, "IDR");
    expect(assessment.meetsGuideline).toBe(true);
    expect(assessment.ratio).toBeGreaterThanOrEqual(20);
  });

  it("treats zero data cost as always meeting the guideline rather than dividing by zero", () => {
    const assessment = assessRewardToDataCost(300, 0, "IDR");
    expect(assessment.meetsGuideline).toBe(true);
    expect(Number.isFinite(assessment.ratio)).toBe(false);
  });

  it("computes independently for AUD without mixing currencies", () => {
    const assessment = assessRewardToDataCost(1_500, 30, "AUD");
    expect(assessment.dataCostMinorUnits).toBeGreaterThan(0);
    expect(assessment.rewardValueMinorUnits).toBe(1_500);
  });

  it("returns a null ratio (not a guessed one) when no server-computed reward value is available yet (task 7.8.c: B never reaches a browser)", () => {
    const assessment = assessRewardToDataCost(null, 180, "IDR");
    expect(assessment.ratio).toBeNull();
    expect(assessment.meetsGuideline).toBeNull();
    expect(assessment.rewardValueMinorUnits).toBeNull();
    expect(assessment.dataCostMinorUnits).toBeGreaterThan(0);
  });
});

describe("describeRewardDataCostRatio", () => {
  it("names the actual ratio in a failing message, not just pass/fail", () => {
    const assessment = assessRewardToDataCost(600, 180, "IDR");
    const message = describeRewardDataCostRatio(assessment, t);
    expect(message).toContain("below the platform's 20x guideline");
  });

  it("confirms the guideline is met in a passing message", () => {
    const assessment = assessRewardToDataCost(15_000, 180, "IDR");
    const message = describeRewardDataCostRatio(assessment, t);
    expect(message).toContain("at or above the platform's 20x guideline");
  });

  it("says plainly that the ratio isn't available yet, rather than showing a fabricated number", () => {
    const assessment = assessRewardToDataCost(null, 180, "IDR");
    const message = describeRewardDataCostRatio(assessment, t);
    expect(message).toContain("isn't available yet");
  });
});
