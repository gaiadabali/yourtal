"use client";

import type { ChangeEvent } from "react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { UseFormReturn } from "react-hook-form";
import { Button } from "@yourtal/ui/button";
import { Input } from "@yourtal/ui/input";
import { setRewardConfigLive } from "./campaign-builder-actions";
import type { CampaignDraft, CampaignDraftFormValues } from "./campaign-draft";
import { campaignFormErrorText } from "./campaign-draft";
import {
  draftBudgetIssue,
  oneCompletionPoints,
  rewardConfigPatchFor,
} from "./campaign-reward-patch";

export interface CampaignEditorBudgetProps {
  draft: CampaignDraft;
  form: UseFormReturn<CampaignDraftFormValues>;
  onChange: (draft: CampaignDraft) => void;
  disabled?: boolean;
  isLiveMode: boolean;
  merchantName: string;
}

/** A whole number of points, positive or negative — see the matching helper's comment in `campaign-editor-reward.tsx`: the non-positive check now lives in `campaign-draft.ts`'s validator and actually fires, instead of a clamp silently rewriting the value. */
function toWholePoints(raw: string): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.round(parsed) : NaN;
}

type SaveState = { status: "idle" | "saving" | "saved" } | { status: "error"; message: string };

/**
 * Total budget and an optional daily cap, in points — the pool this campaign
 * draws reward payouts from (docs/17 §2's Campaigns zone: "budget, point
 * allocation"). A daily cap of null means uncapped, an explicit choice, not
 * a default nobody made.
 *
 * 14.2: both save with the reward config (`PUT .../reward`), which the
 * ledger enforces: rewards stop when the budget is spent, and the daily cap
 * stops them for the rest of the region's day. Checked here first so the
 * author sees the reason beside the field; the server checks the same rules.
 *
 * `totalBudgetPoints` is registered on the shared `form` (YT-0525 — see
 * `campaign-editor.tsx`'s doc comment); `dailyCapPoints` stays a plain
 * controlled field.
 */
export function CampaignEditorBudget({
  draft,
  form,
  onChange,
  disabled,
  isLiveMode,
  merchantName,
}: CampaignEditorBudgetProps) {
  const t = useTranslations("studio");
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const { budget } = draft;
  const issue = draftBudgetIssue(draft);

  function change(next: CampaignDraft["budget"]) {
    setSaveState({ status: "idle" });
    onChange({ ...draft, budget: next });
  }

  async function saveBudget() {
    const patch = rewardConfigPatchFor(draft);
    if (patch === null) {
      setSaveState({ status: "error", message: t("campaignBuilder.budget.needsReward") });
      return;
    }
    if (issue !== null) return;
    setSaveState({ status: "saving" });
    const result = await setRewardConfigLive(draft.businessId, draft.id, merchantName, patch);
    if (!result.ok) {
      setSaveState({ status: "error", message: result.message });
      return;
    }
    // Keep the author's unsaved edits on other tabs; take the saved budget back.
    onChange({ ...draft, budget: result.value.budget });
    setSaveState({ status: "saved" });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs font-sans text-fg-muted">{t("campaignBuilder.budget.hint")}</p>
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex-1">
          <Input
            label={t("campaignBuilder.budget.totalLabel")}
            type="number"
            min={0}
            disabled={disabled}
            {...form.register("totalBudgetPoints", {
              setValueAs: toWholePoints,
              onChange: (event: ChangeEvent<HTMLInputElement>) => {
                const value = toWholePoints(event.target.value);
                if (Number.isFinite(value)) change({ ...budget, totalBudgetPoints: value });
              },
            })}
            {...(form.formState.errors.totalBudgetPoints?.message
              ? {
                  errorMessage: campaignFormErrorText(
                    t,
                    form.formState.errors.totalBudgetPoints.message,
                  ),
                }
              : {})}
          />
        </div>
        <div className="flex-1">
          <Input
            label={t("campaignBuilder.budget.dailyCapLabel")}
            type="number"
            min={0}
            value={budget.dailyCapPoints ?? ""}
            disabled={disabled}
            placeholder={t("campaignBuilder.budget.dailyCapPlaceholder")}
            onChange={(event) => {
              const raw = event.target.value;
              if (raw.trim().length === 0) {
                change({ ...budget, dailyCapPoints: null });
                return;
              }
              const parsed = Number(raw);
              if (Number.isFinite(parsed)) {
                change({ ...budget, dailyCapPoints: Math.max(0, Math.round(parsed)) });
              }
            }}
          />
        </div>
      </div>

      {issue !== null && budget.totalBudgetPoints > 0 ? (
        <p role="alert" className="text-xs font-sans text-danger">
          {t(`campaignBuilder.budget.${issue}`, { points: oneCompletionPoints(draft) })}
        </p>
      ) : null}

      {isLiveMode ? (
        <>
          {saveState.status === "error" ? (
            <p role="alert" className="text-xs font-sans text-danger">
              {saveState.message}
            </p>
          ) : null}
          {saveState.status === "saved" ? (
            <p role="status" className="text-xs font-sans text-fg-muted">
              {t("campaignBuilder.budget.saved")}
            </p>
          ) : null}
          <Button
            type="button"
            size="sm"
            className="w-fit"
            disabled={disabled || issue !== null || saveState.status === "saving"}
            onClick={() => void saveBudget()}
          >
            {t("campaignBuilder.budget.save")}
          </Button>
        </>
      ) : null}
    </div>
  );
}
