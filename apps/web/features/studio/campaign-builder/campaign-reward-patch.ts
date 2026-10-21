import type { RewardConfigPatch } from "./campaign-builder-actions";
import type { CampaignDraft } from "./campaign-draft";

/** What one viewer can earn: the base plus the whole accuracy bonus. */
export function oneCompletionPoints(draft: CampaignDraft): number {
  return draft.rewardPoints + draft.accuracyBonusPoints;
}

/** 14.2: why the budget tab's numbers could never pay out, or null. Mirrors the server's own refusal. */
export type CampaignBudgetIssue =
  "budgetBelowOneCompletion" | "dailyCapBelowOneCompletion" | "dailyCapAboveBudget";

export function draftBudgetIssue(draft: CampaignDraft): CampaignBudgetIssue | null {
  const { totalBudgetPoints, dailyCapPoints } = draft.budget;
  const oneCompletion = oneCompletionPoints(draft);
  if (totalBudgetPoints < oneCompletion) return "budgetBelowOneCompletion";
  if (dailyCapPoints === null) return null;
  if (dailyCapPoints < oneCompletion) return "dailyCapBelowOneCompletion";
  if (dailyCapPoints > totalBudgetPoints) return "dailyCapAboveBudget";
  return null;
}

/**
 * The full `PUT .../reward` body for this draft: the reward and its budget
 * save together. Null until the author has chosen which funded points pay.
 * A budget never set (0) is raised to one completion, so saving the reward
 * first never fails on a Budget tab the author has not visited yet.
 */
export function rewardConfigPatchFor(draft: CampaignDraft): RewardConfigPatch | null {
  if (!draft.allocationId) return null;
  return {
    allocationId: draft.allocationId,
    rewardPointsPerCompletion: draft.rewardPoints,
    accuracyBonusPoints: draft.accuracyBonusPoints,
    maxPointsForCampaign: Math.max(draft.budget.totalBudgetPoints, oneCompletionPoints(draft)),
    dailyCapPoints: draft.budget.dailyCapPoints,
  };
}

/**
 * 2.10.b (F127): the text for a refused reward save. A receipt package pays
 * receipt rewards only (`allocation_not_campaign_funding`), which the server
 * words with an allocation id; the author gets the catalogue copy instead.
 * Every other refusal keeps the server's own message.
 */
export function rewardErrorText(
  failure: { message: string; code?: string },
  t: (key: "campaignBuilder.reward.allocationReceiptPackage") => string,
): string {
  return failure.code === "allocation_not_campaign_funding"
    ? t("campaignBuilder.reward.allocationReceiptPackage")
    : failure.message;
}
