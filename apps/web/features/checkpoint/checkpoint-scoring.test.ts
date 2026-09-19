import { toPoints } from "@yourtal/contracts/money";
import { describe, expect, it } from "vitest";
import {
  computeRewardSplit,
  isAnswerCorrect,
  isScorableQuestion,
  totalEarned,
} from "./checkpoint-scoring";
import {
  likertFixture,
  makeCampaignFixture as makeCampaign,
  multipleChoiceFixture,
  rankedFixture,
  shortTextFixture,
  trueFalseFixture,
} from "./checkpoint-question-fixtures";
import type { QuestionAnswer } from "./checkpoint-types";

describe("isScorableQuestion", () => {
  it("scores multiple_choice and true_false, never likert/ranked/short_text", () => {
    expect(isScorableQuestion(multipleChoiceFixture)).toBe(true);
    expect(isScorableQuestion(trueFalseFixture)).toBe(true);
    expect(isScorableQuestion(likertFixture)).toBe(false);
    expect(isScorableQuestion(rankedFixture)).toBe(false);
    expect(isScorableQuestion(shortTextFixture)).toBe(false);
  });
});

describe("isAnswerCorrect", () => {
  it("is correct only when the selected option matches correctOptionId", () => {
    expect(
      isAnswerCorrect(multipleChoiceFixture, {
        type: "multiple_choice",
        selectedOptionId: multipleChoiceFixture.correctOptionId,
      }),
    ).toBe(true);
    expect(
      isAnswerCorrect(multipleChoiceFixture, {
        type: "multiple_choice",
        selectedOptionId: multipleChoiceFixture.options[0]?.id ?? "",
      }),
    ).toBe(multipleChoiceFixture.options[0]?.id === multipleChoiceFixture.correctOptionId);
  });

  it("is never correct for opinion/free-text types, even with a matching-shaped answer", () => {
    expect(isAnswerCorrect(likertFixture, { type: "likert", value: 5 })).toBe(false);
    expect(isAnswerCorrect(shortTextFixture, { type: "short_text", text: "anything" })).toBe(false);
    expect(isAnswerCorrect(rankedFixture, { type: "ranked", orderedItemIds: [] })).toBe(false);
  });

  it("is false when there is no answer at all", () => {
    expect(isAnswerCorrect(trueFalseFixture, undefined)).toBe(false);
  });
});

describe("computeRewardSplit", () => {
  const questions = [multipleChoiceFixture, trueFalseFixture, likertFixture];

  it("base_only campaigns: the full reward is the guaranteed base, with no bonus", () => {
    const campaign = makeCampaign({ scoringRule: "base_only", rewardPoints: toPoints(500) });
    const split = computeRewardSplit(campaign, questions, new Map());
    expect(split.baseReward).toBe(500);
    expect(split.earnedBonus).toBe(0);
    expect(split.accuracyFraction).toBeNull();
  });

  it("base_plus_accuracy_bonus with 0% accuracy: base is paid, bonus is zero", () => {
    const campaign = makeCampaign({ rewardPoints: toPoints(1000) });
    const answers = new Map<string, QuestionAnswer>([
      [multipleChoiceFixture.id, { type: "multiple_choice", selectedOptionId: "wrong-option" }],
      [trueFalseFixture.id, { type: "true_false", value: !trueFalseFixture.correctAnswer }],
    ]);
    const split = computeRewardSplit(campaign, questions, answers);
    expect(split.baseReward).toBe(600);
    expect(split.earnedBonus).toBe(0);
    expect(split.accuracyFraction).toBe(0);
    expect(totalEarned(split)).toBe(600);
  });

  it("base_plus_accuracy_bonus with 100% accuracy: full base plus full bonus", () => {
    const campaign = makeCampaign({ rewardPoints: toPoints(1000) });
    const answers = new Map<string, QuestionAnswer>([
      [
        multipleChoiceFixture.id,
        { type: "multiple_choice", selectedOptionId: multipleChoiceFixture.correctOptionId },
      ],
      [trueFalseFixture.id, { type: "true_false", value: trueFalseFixture.correctAnswer }],
    ]);
    const split = computeRewardSplit(campaign, questions, answers);
    expect(split.baseReward).toBe(600);
    expect(split.earnedBonus).toBe(400);
    expect(split.accuracyFraction).toBe(1);
    expect(totalEarned(split)).toBe(1000);
  });

  it("base_plus_accuracy_bonus with partial accuracy scales the bonus proportionally", () => {
    const campaign = makeCampaign({ rewardPoints: toPoints(1000) });
    const answers = new Map<string, QuestionAnswer>([
      [
        multipleChoiceFixture.id,
        { type: "multiple_choice", selectedOptionId: multipleChoiceFixture.correctOptionId },
      ],
      [trueFalseFixture.id, { type: "true_false", value: !trueFalseFixture.correctAnswer }],
    ]);
    const split = computeRewardSplit(campaign, questions, answers);
    expect(split.accuracyFraction).toBe(0.5);
    expect(split.earnedBonus).toBe(200);
    expect(totalEarned(split)).toBe(800);
  });

  it("never hard-fails an unanswered set: an empty answer map still pays the guaranteed base", () => {
    const campaign = makeCampaign({ rewardPoints: toPoints(1000) });
    const split = computeRewardSplit(campaign, questions, new Map());
    expect(split.baseReward).toBe(600);
    expect(totalEarned(split)).toBe(600);
  });

  it("a bank with no scorable questions has no meaningful accuracy bonus", () => {
    const campaign = makeCampaign({ rewardPoints: toPoints(1000) });
    const split = computeRewardSplit(
      campaign,
      [likertFixture, rankedFixture, shortTextFixture],
      new Map(),
    );
    expect(split.accuracyFraction).toBeNull();
    expect(split.scorableCount).toBe(0);
  });
});
