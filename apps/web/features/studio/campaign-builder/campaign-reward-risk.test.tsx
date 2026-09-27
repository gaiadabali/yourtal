import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { useTranslations } from "next-intl";
import { describe, expect, it } from "vitest";
import { StudioIntlProvider } from "../studio-test-i18n";
import {
  assessRewardToDataCost,
  describeRewardDataCostRatio,
  type RewardDataCostAssessment,
} from "./campaign-reward-risk";

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

/**
 * `describeRewardDataCostRatio` takes a real `useTranslations("studio")`
 * translator, so it can only be exercised from inside a rendered component
 * (`next-intl`'s own `Translator` type is not constructible outside one in
 * a way TypeScript accepts as interchangeable — see
 * `checkpoint/use-question-timer.test.tsx` for the same workaround).
 */
function Message({ assessment }: { assessment: RewardDataCostAssessment }) {
  const t = useTranslations("studio");
  return <p>{describeRewardDataCostRatio(assessment, t)}</p>;
}

function renderMessage(assessment: RewardDataCostAssessment) {
  render(
    <StudioIntlProvider>
      <Message assessment={assessment} />
    </StudioIntlProvider>,
  );
}

describe("describeRewardDataCostRatio", () => {
  it("names the actual ratio in a failing message, not just pass/fail", () => {
    renderMessage(assessRewardToDataCost(600, 180, "IDR"));
    expect(screen.getByText(/below the platform's 20x guideline/)).toBeInTheDocument();
  });

  it("confirms the guideline is met in a passing message", () => {
    renderMessage(assessRewardToDataCost(15_000, 180, "IDR"));
    expect(screen.getByText(/at or above the platform's 20x guideline/)).toBeInTheDocument();
  });

  it("says plainly that the ratio isn't available yet, rather than showing a fabricated number", () => {
    renderMessage(assessRewardToDataCost(null, 180, "IDR"));
    expect(screen.getByText(/isn't available yet/)).toBeInTheDocument();
  });
});
