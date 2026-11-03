import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { useTranslations } from "next-intl";
import { describe, expect, it } from "vitest";
import { StudioIntlProvider } from "../studio-test-i18n";
import {
  assessRewardToDataCost,
  rewardRatioText,
  rewardRatioView,
  type RewardRatioView,
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
 * The ratio text takes a real `useTranslations("studio")` translator, so it can only be
 * exercised from inside a rendered component (`next-intl`'s own `Translator` type is not
 * constructible outside one in a way TypeScript accepts as interchangeable — see
 * `checkpoint/use-question-timer.test.tsx` for the same workaround).
 */
function Message({ view }: { view: RewardRatioView }) {
  const t = useTranslations("studio");
  return <p>{rewardRatioText(view, t)}</p>;
}

function renderMessage(input: Partial<Parameters<typeof rewardRatioView>[0]>) {
  const view = rewardRatioView({
    rewardPoints: 5,
    rewardValueMinorUnits: null,
    estimatedDataMb: 180,
    currency: "IDR",
    durationPending: false,
    ...input,
  });
  render(
    <StudioIntlProvider>
      <Message view={view} />
    </StudioIntlProvider>,
  );
  return view;
}

describe("rewardRatioText (B5: one plain message for both panels)", () => {
  it("names the actual ratio in a failing message, kindly, with no word like insulting", () => {
    renderMessage({ rewardPoints: 5, rewardValueMinorUnits: 600 });
    expect(screen.getByText(/below the platform's 20x guideline/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/insult/i);
  });

  it("confirms the guideline is met in a passing message", () => {
    renderMessage({ rewardValueMinorUnits: 15_000 });
    expect(screen.getByText(/at or above the platform's 20x guideline/)).toBeInTheDocument();
  });

  it("asks a draft with no reward yet to set one, instead of calling it too small", () => {
    const view = renderMessage({ rewardPoints: 0, rewardValueMinorUnits: null });
    expect(view.note).toBe("needsReward");
    expect(screen.getByText(/Set a reward to see how it compares/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/insult|only about 0x/i);
  });

  it("still asks for a reward when a 0-point draft carries an old priced value", () => {
    expect(
      rewardRatioView({
        rewardPoints: 0,
        rewardValueMinorUnits: 0,
        estimatedDataMb: 6,
        currency: "AUD",
        durationPending: false,
      }).note,
    ).toBe("needsReward");
  });

  it("says to save, in plain words, when a reward is entered but not priced yet", () => {
    renderMessage({ rewardPoints: 5, rewardValueMinorUnits: null });
    expect(screen.getByText(/Save the reward to see how it compares/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/campaign API|isn.t available/);
  });

  it("does not trust a priced value once the reward on screen differs from the saved one", () => {
    const view = rewardRatioView({
      rewardPoints: 9,
      rewardValueMinorUnits: 12_000,
      estimatedDataMb: 6,
      currency: "AUD",
      durationPending: false,
      rewardUnsaved: true,
    });
    expect(view.note).toBe("needsSave");
  });

  it("waits for the video when its length is not known, before anything about the reward", () => {
    const view = renderMessage({ durationPending: true, rewardPoints: 0 });
    expect(view.note).toBe("needsVideo");
    expect(screen.getByText(/once your video has finished processing/)).toBeInTheDocument();
  });
});
