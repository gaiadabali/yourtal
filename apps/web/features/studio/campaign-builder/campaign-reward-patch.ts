import type { RewardConfigPatch } from "./campaign-builder-actions";
import type { CampaignDraft } from "./campaign-draft";

/** A fixed reward has no accuracy bonus, whatever number was left in the field. */
export function effectiveBonusPoints(draft: CampaignDraft): number {
  return draft.scoringRule === "base_plus_accuracy_bonus" ? draft.accuracyBonusPoints : 0;
}

/** What one viewer can earn: the base plus the whole accuracy bonus. */
export function oneCompletionPoints(draft: CampaignDraft): number {
  return draft.rewardPoints + effectiveBonusPoints(draft);
}

/** Live mode: the reward on screen is not what the server holds (mock mode saves nothing, so is never "unsaved"). */
export function draftRewardUnsaved(draft: CampaignDraft): boolean {
  const saved = draft.savedReward;
  if (saved === undefined) return false;
  if (saved === null) return draft.rewardPoints > 0;
  return (
    saved.rewardPoints !== draft.rewardPoints ||
    saved.accuracyBonusPoints !== effectiveBonusPoints(draft)
  );
}

/** Live mode: the reward, its funding or the budget on screen is not what the server holds. */
export function draftRewardConfigUnsaved(draft: CampaignDraft): boolean {
  const saved = draft.savedReward;
  if (saved === undefined) return false;
  if (saved === null) return true;
  return (
    draftRewardUnsaved(draft) ||
    saved.allocationId !== draft.allocationId ||
    saved.totalBudgetPoints !== draft.budget.totalBudgetPoints ||
    saved.dailyCapPoints !== draft.budget.dailyCapPoints
  );
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
    accuracyBonusPoints: effectiveBonusPoints(draft),
    maxPointsForCampaign: Math.max(draft.budget.totalBudgetPoints, oneCompletionPoints(draft)),
    dailyCapPoints: draft.budget.dailyCapPoints,
  };
}

type RewardErrorKey =
  | "campaignBuilder.reward.allocationReceiptPackage"
  | "campaignBuilder.reward.errors.ceilingFixed"
  | "campaignBuilder.reward.errors.ceilingWithBonus"
  | "campaignBuilder.reward.errors.ceilingTooShort"
  | "campaignBuilder.reward.errors.bonusTooHigh";

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * 2.10.b (F127), F14: the text for a refused reward save, in the author's language.
 * A receipt package pays receipt rewards only (`allocation_not_campaign_funding`),
 * which the server words with an allocation id; the F14 limit is per minute, so it
 * is worded here from the limit for THIS video's length (`details.maxPoints`), with
 * no internal code and no bonus unless there is one. Every other refusal keeps the
 * server's own message.
 */
export function rewardErrorText(
  failure: { message: string; code?: string; details?: Record<string, unknown> },
  t: (key: RewardErrorKey, values?: Record<string, number>) => string,
): string {
  if (failure.code === "allocation_not_campaign_funding") {
    return t("campaignBuilder.reward.allocationReceiptPackage");
  }
  if (failure.code === "accuracy_bonus_too_high")
    return t("campaignBuilder.reward.errors.bonusTooHigh");
  if (failure.code === "reward_exceeds_ceiling") {
    const max = asNumber(failure.details?.["maxPoints"]);
    const seconds = asNumber(failure.details?.["durationSeconds"]);
    if (max === null || seconds === null) return failure.message;
    if (max === 0) return t("campaignBuilder.reward.errors.ceilingTooShort", { seconds });
    return failure.details?.["hasBonus"] === true
      ? t("campaignBuilder.reward.errors.ceilingWithBonus", { max, seconds })
      : t("campaignBuilder.reward.errors.ceilingFixed", { max, seconds });
  }
  return failure.message;
}

/** What a successful `PUT .../reward` hands back to the open draft: the saved reward, funding, budget and the server-priced value, and nothing the author may have edited since. */
export function savedRewardPatch(saved: CampaignDraft): Partial<CampaignDraft> {
  return {
    rewardPoints: saved.rewardPoints,
    allocationId: saved.allocationId,
    accuracyBonusPoints: saved.accuracyBonusPoints,
    rewardValueMinorUnits: saved.rewardValueMinorUnits,
    rewardCurrency: saved.rewardCurrency,
    budget: saved.budget,
    savedReward: saved.savedReward ?? null,
  };
}
