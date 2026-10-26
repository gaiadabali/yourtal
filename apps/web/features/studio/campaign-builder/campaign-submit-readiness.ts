import { questionsAskedFor } from "@/features/player/question-schedule";
import type { CampaignDraft } from "./campaign-draft";
import { draftCompleteQuestionCount, draftDurationSeconds } from "./campaign-draft";
import { draftRewardConfigUnsaved, oneCompletionPoints } from "./campaign-reward-patch";

/** One thing review needs that the draft does not have yet. Each names the tab where it is fixed. */
export type SubmitGap =
  | "title"
  | "synopsis"
  | "videoMissing"
  | "videoProcessing"
  | "reward"
  | "rewardUnsaved"
  | "budget"
  | "questions";

export interface SubmitReadiness {
  gaps: SubmitGap[];
  questionsNeeded: number;
  questionsHave: number;
}

/** F10 and the 3x rule, as the API checks them at submit (`campaign-readiness.ts` there). */
const BANK_MULTIPLE = 3;

/**
 * What the API needs before it will take a draft into review, worked out here first so
 * the author is told what is missing instead of finding out from a refusal. The API
 * checks the same list (and is the one that decides).
 */
export function submitReadiness(draft: CampaignDraft): SubmitReadiness {
  const gaps: SubmitGap[] = [];
  if (draft.title.trim().length === 0) gaps.push("title");
  if (draft.synopsis.trim().length === 0) gaps.push("synopsis");
  if (draft.video.status === "uploading" || draft.video.status === "processing") {
    gaps.push("videoProcessing");
  } else if (draft.video.status !== "ready") {
    gaps.push("videoMissing");
  }
  if (draft.rewardPoints <= 0 || draft.savedReward === null) {
    gaps.push("reward");
  } else if (draftRewardConfigUnsaved(draft)) {
    gaps.push("rewardUnsaved");
  } else if (
    draft.budget.totalBudgetPoints <= 0 ||
    draft.budget.totalBudgetPoints < oneCompletionPoints(draft)
  ) {
    // Saved with the reward, so it is only short of one viewer's reward if it was never set.
    gaps.push("budget");
  }
  const questionsNeeded = questionsAskedFor(draftDurationSeconds(draft)) * BANK_MULTIPLE;
  const questionsHave = draftCompleteQuestionCount(draft);
  if (questionsHave < questionsNeeded) gaps.push("questions");
  return { gaps, questionsNeeded, questionsHave };
}

const SERVER_GAPS: Record<string, SubmitGap> = {
  title: "title",
  synopsis: "synopsis",
  video: "videoMissing",
  reward: "reward",
  budget: "budget",
  questions: "questions",
};

/** The same list from the API's own `campaign_not_ready` refusal (`details.missing`), or null when it is not one. */
export function submitGapsFromRefusal(failure: {
  code?: string;
  details?: Record<string, unknown>;
}): SubmitReadiness | null {
  if (failure.code !== "campaign_not_ready") return null;
  const missing = failure.details?.["missing"];
  if (!Array.isArray(missing)) return null;
  const gaps = missing.flatMap((item): SubmitGap[] => {
    const gap = typeof item === "string" ? SERVER_GAPS[item] : undefined;
    return gap === undefined ? [] : [gap];
  });
  const number = (value: unknown) => (typeof value === "number" ? value : 0);
  return {
    gaps,
    questionsNeeded: number(failure.details?.["questionsNeeded"]),
    questionsHave: number(failure.details?.["questionsHave"]),
  };
}
