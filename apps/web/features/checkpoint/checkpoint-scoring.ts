import type { Campaign } from "@yourtal/contracts/campaign";
import type { Question } from "@yourtal/contracts/question";
import type { Points } from "@yourtal/contracts/money";
import { asDisplayPoints } from "@yourtal/contracts/money/format";
import type { QuestionAnswer } from "./checkpoint-types";

/**
 * This module runs client-side (it backs the live result screen). It uses
 * `asDisplayPoints` from `@yourtal/contracts/money/format`, which is the
 * dependency-free half of the money module: `money.ts` itself carries the
 * Zod schemas, and value-importing from it would pull the whole Zod runtime
 * into this route's client bundle (~100 KB gz) for no safety gain, since
 * `campaign.rewardPoints` arrived here already validated.
 */

/**
 * The illustrative split from docs/06-longform-video-and-attention.md
 * section 4.2: "base 60% of advertised value for completing and answering
 * + up to 40% more for accuracy". The real ratio belongs to the Reward
 * Engine once it exists server-side; this constant is isolated here
 * precisely so it is a one-line swap for whoever wires that up, rather
 * than a number buried in JSX.
 */
const BASE_REWARD_FRACTION = 0.6;

/**
 * Per docs/06 section 4.1: multiple_choice and true_false have a correct
 * answer and are scored; likert, ranked and short_text are opinion/free
 * text and are never scored for correctness.
 */
export function isScorableQuestion(question: Question): boolean {
  return question.type === "multiple_choice" || question.type === "true_false";
}

export function isAnswerCorrect(question: Question, answer: QuestionAnswer | undefined): boolean {
  if (!answer) {
    return false;
  }
  switch (question.type) {
    case "multiple_choice":
      return answer.type === "multiple_choice" && answer.selectedOptionId === question.correctOptionId;
    case "true_false":
      return answer.type === "true_false" && answer.value === question.correctAnswer;
    case "likert":
    case "ranked":
    case "short_text":
      return false;
    default: {
      const exhaustive: never = question;
      return exhaustive;
    }
  }
}

export interface RewardSplit {
  /** Guaranteed for watching and answering, regardless of accuracy (docs/06 §4.2). */
  baseReward: Points;
  /** The most accuracy bonus this attempt could have earned. */
  maxBonus: Points;
  /** The accuracy bonus actually earned this attempt. */
  earnedBonus: Points;
  /** Fraction correct among scorable questions, or null if there are none (no bonus is meaningful). */
  accuracyFraction: number | null;
  correctCount: number;
  scorableCount: number;
}

/**
 * Splits a campaign's advertised reward into a guaranteed base and a
 * conditional accuracy bonus (docs/tasks/phase-u-ui.md YT-0413: "Result
 * screen distinguishes base reward from accuracy bonus"). For
 * `base_only` campaigns, the full reward is the guaranteed base and there
 * is no bonus to show.
 */
export function computeRewardSplit(
  campaign: Campaign,
  questions: readonly Question[],
  answers: ReadonlyMap<string, QuestionAnswer>,
): RewardSplit {
  const scorable = questions.filter(isScorableQuestion);
  const correctCount = scorable.filter((question) => isAnswerCorrect(question, answers.get(question.id))).length;

  if (campaign.scoringRule === "base_only") {
    return {
      baseReward: campaign.rewardPoints,
      maxBonus: asDisplayPoints(0),
      earnedBonus: asDisplayPoints(0),
      accuracyFraction: null,
      correctCount,
      scorableCount: scorable.length,
    };
  }

  const baseReward = asDisplayPoints(Math.round(campaign.rewardPoints * BASE_REWARD_FRACTION));
  const maxBonus = asDisplayPoints(campaign.rewardPoints - baseReward);

  if (scorable.length === 0) {
    return { baseReward, maxBonus, earnedBonus: asDisplayPoints(0), accuracyFraction: null, correctCount, scorableCount: 0 };
  }

  const accuracyFraction = correctCount / scorable.length;
  const earnedBonus = asDisplayPoints(Math.round(maxBonus * accuracyFraction));
  return { baseReward, maxBonus, earnedBonus, accuracyFraction, correctCount, scorableCount: scorable.length };
}

/** Convenience for display: the total actually paid out this attempt. */
export function totalEarned(split: RewardSplit): Points {
  return asDisplayPoints(split.baseReward + split.earnedBonus);
}
