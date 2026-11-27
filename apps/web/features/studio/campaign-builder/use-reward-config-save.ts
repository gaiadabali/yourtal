"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { setRewardConfigLive } from "./campaign-builder-actions";
import type { CampaignDraft } from "./campaign-draft";
import type { RewardConfigField } from "./campaign-reward-patch";
import {
  oneCompletionPoints,
  rewardConfigGap,
  rewardConfigPatchFor,
  rewardErrorText,
  rewardFailureField,
  savedRewardPatch,
} from "./campaign-reward-patch";

type RewardSaveState =
  | { status: "idle" | "saving" | "saved" }
  | { status: "error"; field: RewardConfigField; message: string };

export interface RewardConfigSave {
  state: RewardSaveState;
  /** Saves the reward, its funding and the budget together, from whichever tab is open. */
  save: () => Promise<void>;
  /** An edit makes a shown refusal or "saved" stale. */
  clear: () => void;
}

/**
 * One owner for the reward-and-budget save (`PUT .../reward`). The Reward and Budget tabs
 * both press this same save, so the combined draft is checked once and a refusal lands on
 * the field it is about, not on the tab that happened to press Save.
 */
export function useRewardConfigSave(
  draft: CampaignDraft,
  merchantName: string,
  allocationCount: number,
  onPatch: (patch: Partial<CampaignDraft>) => void,
): RewardConfigSave {
  const t = useTranslations("studio");
  const [state, setState] = useState<RewardSaveState>({ status: "idle" });

  async function save() {
    const gap = rewardConfigGap(draft, allocationCount);
    const patch = rewardConfigPatchFor(draft);
    if (gap !== null || patch === null) {
      const message =
        gap?.field === "budget"
          ? t(`campaignBuilder.budget.${gap.reason}`, { points: oneCompletionPoints(draft) })
          : t(
              allocationCount === 0
                ? "campaignBuilder.reward.allocationNone"
                : "campaignBuilder.reward.allocationRequired",
            );
      setState({ status: "error", field: gap?.field ?? "allocation", message });
      return;
    }
    setState({ status: "saving" });
    const result = await setRewardConfigLive(draft.businessId, draft.id, merchantName, patch);
    if (!result.ok) {
      setState({
        status: "error",
        field: rewardFailureField(result.code),
        message: rewardErrorText(result, t),
      });
      return;
    }
    // Keep the author's unsaved edits, including any typed while this saved; take the saved reward and budget back.
    onPatch(savedRewardPatch(result.value));
    setState({ status: "saved" });
  }

  return {
    state,
    save,
    clear: () => setState((current) => (current.status === "idle" ? current : { status: "idle" })),
  };
}
