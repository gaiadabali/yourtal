import { requiredBankSize } from "@yourtal/contracts/question/bank";
import type { CampaignDraft } from "../persistence/campaign-draft.repository";
import type { BankQuestionRecord } from "../persistence/question-bank.repository";

/** What a draft still lacks before a moderator can review it. */
export type SubmitGap = "title" | "synopsis" | "video" | "reward" | "budget" | "questions";

export interface CampaignReadiness {
  readonly gaps: readonly SubmitGap[];
  /** How many questions the bank needs (F10, 3x those asked) and how many it has, for the message. */
  readonly questionsNeeded: number;
  readonly questionsHave: number;
}

/** Questions that could still be asked: not retired, and not refused by the PII screen. */
export function usableQuestionCount(bank: readonly BankQuestionRecord[]): number {
  return bank.filter((row) => row.status !== "retired" && row.piiScreen !== "rejected").length;
}

/**
 * What review needs, in one place. The database already refuses an in_review row
 * with no media or reward mirror, but only as a bare "the database refused this
 * transition"; this names the gaps first. A moderator also needs words to read,
 * funded points to pay from, a budget that can pay one viewer, and (F10) enough
 * questions to draw a different set for each viewer from.
 */
export function campaignReadiness(
  draft: CampaignDraft,
  bank: readonly BankQuestionRecord[],
): CampaignReadiness {
  const gaps: SubmitGap[] = [];
  if (draft.title.trim().length === 0) gaps.push("title");
  if (draft.synopsis.trim().length === 0) gaps.push("synopsis");
  if (draft.hlsUrl === null || draft.posterUrl === null || draft.teaserUrl === null) {
    gaps.push("video");
  }
  const config = draft.rewardConfig;
  if (config === null || draft.rewardPoints === null || config.rewardPointsPerCompletion <= 0) {
    gaps.push("reward");
  } else if (
    config.maxPointsForCampaign <
    config.rewardPointsPerCompletion + config.accuracyBonusPoints
  ) {
    gaps.push("budget");
  }
  const questionsNeeded = requiredBankSize(draft.durationSeconds);
  const questionsHave = usableQuestionCount(bank);
  if (questionsHave < questionsNeeded) gaps.push("questions");
  return { gaps, questionsNeeded, questionsHave };
}

const GAP_TEXT: Record<Exclude<SubmitGap, "questions">, string> = {
  title: "a title",
  synopsis: "a synopsis",
  video: "a video that has finished processing",
  reward: "a saved reward",
  budget: "a total budget that covers at least one viewer's reward",
};

/** Plain English for the API's own message; the console words the same gaps in the author's language. */
export function describeReadiness(readiness: CampaignReadiness): string {
  const parts = readiness.gaps.map((gap) =>
    gap === "questions"
      ? `at least ${String(readiness.questionsNeeded)} questions (it has ${String(readiness.questionsHave)})`
      : GAP_TEXT[gap],
  );
  return `This campaign can't go to review yet. It still needs ${parts.join(", ")}.`;
}
