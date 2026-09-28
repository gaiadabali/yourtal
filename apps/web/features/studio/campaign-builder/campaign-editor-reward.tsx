"use client";

import type { ChangeEvent } from "react";
import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import type { UseFormReturn } from "react-hook-form";
import type { BillingAllocation } from "@yourtal/contracts/billing";
import { Badge } from "@yourtal/ui/badge";
import { Button } from "@yourtal/ui/button";
import { Input } from "@yourtal/ui/input";
import { MoneyAmount } from "@yourtal/ui/money-amount";
import { NativeSelect } from "@yourtal/ui/native-select";
import type { CampaignScoringRule } from "@yourtal/contracts/campaign";
import { useRegion } from "@/features/region/use-region";
import { setRewardConfigLive } from "./campaign-builder-actions";
import { assessRewardToDataCost, describeRewardDataCostRatio } from "./campaign-reward-risk";
import type { CampaignDraft, CampaignDraftFormValues } from "./campaign-draft";
import { draftEstimatedDataMb } from "./campaign-draft";

export interface CampaignEditorRewardProps {
  draft: CampaignDraft;
  form: UseFormReturn<CampaignDraftFormValues>;
  onChange: (draft: CampaignDraft) => void;
  disabled?: boolean;
  isLiveMode: boolean;
  merchantName: string;
  /** The business's own funded point allocations (`GET .../billing/balance`) — a reward config names one of these (7.3.c). Empty in mock mode or if the viewer cannot see Billing (see `campaigns/page.tsx`'s own comment). */
  allocations: BillingAllocation[];
}

/** A whole number of points, positive or negative — the reward-negativity check lives in `campaign-draft.ts`'s validator, not a clamp here, so a negative entry now actually surfaces "Reward cannot be negative." instead of being silently rewritten to zero. */
function toWholePoints(raw: string): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.round(parsed) : NaN;
}

/**
 * Reward and scoring, plus the authoring-time consequence this ticket asks
 * for explicitly: the reward-to-data-cost ratio banner (docs/06 §2.3 rule
 * 5, "the UI should show them the ratio they have created, not silently
 * accept it"). Uses the region the console is already rendering in
 * (`useRegion()`, ambient from `app/(app)/layout.tsx` — never a hardcoded
 * "Rp"/`id-ID`), so an AU business sees its own currency's numbers.
 *
 * `rewardPoints` is registered on the shared `form` (YT-0525 — see
 * `campaign-editor.tsx`'s doc comment); `scoringRule` stays a plain
 * controlled field via `draft`/`onChange`, since it is not one of the four
 * fields `campaign-draft.ts`'s validator (and so the RHF form) covers.
 */
export function CampaignEditorReward({
  draft,
  form,
  onChange,
  disabled,
  isLiveMode,
  merchantName,
  allocations,
}: CampaignEditorRewardProps) {
  const t = useTranslations("studio");
  const scoringRuleId = useId();
  const allocationSelectId = useId();
  const { currency } = useRegion();
  const estimatedDataMb = draftEstimatedDataMb(draft);
  const [saveState, setSaveState] = useState<
    { status: "idle" } | { status: "saving" } | { status: "error"; message: string }
  >({ status: "idle" });
  const scoringRuleLabels: Record<CampaignScoringRule, string> = {
    base_only: t("campaignBuilder.reward.scoringRuleBaseOnly"),
    base_plus_accuracy_bonus: t("campaignBuilder.reward.scoringRuleBaseBonus"),
  };
  // Live: the server's own priced value from the last successful
  // `PUT .../reward` this session (7.3.h). `null` until then, or always in
  // mock mode — see `campaign-reward-risk.ts`'s own doc comment.
  const assessment = assessRewardToDataCost(draft.rewardValueMinorUnits, estimatedDataMb, currency);

  async function saveReward() {
    if (!draft.allocationId) {
      setSaveState({ status: "error", message: t("campaignBuilder.reward.allocationNone") });
      return;
    }
    setSaveState({ status: "saving" });
    // maxPointsForCampaign (campaignRewardConfigSchema's own ceiling field,
    // distinct from the Budget tab's totalBudgetPoints) reuses that budget
    // number, auto-expanded to at least cover one completion so a business
    // that has not visited Budget yet is never blocked by a stale zero —
    // this feature's own next slice can give it a dedicated field instead.
    const oneCompletion = draft.rewardPoints + draft.accuracyBonusPoints;
    const maxPointsForCampaign = Math.max(draft.budget.totalBudgetPoints, oneCompletion);
    const result = await setRewardConfigLive(draft.businessId, draft.id, merchantName, {
      allocationId: draft.allocationId,
      rewardPointsPerCompletion: draft.rewardPoints,
      accuracyBonusPoints: draft.accuracyBonusPoints,
      maxPointsForCampaign,
    });
    if (!result.ok) {
      setSaveState({ status: "error", message: result.message });
      return;
    }
    onChange(result.value);
    setSaveState({ status: "idle" });
  }

  return (
    <div className="flex flex-col gap-4">
      <Input
        label={t("campaignBuilder.reward.rewardLabel")}
        type="number"
        min={0}
        disabled={disabled}
        {...form.register("rewardPoints", {
          setValueAs: toWholePoints,
          onChange: (event: ChangeEvent<HTMLInputElement>) => {
            const value = toWholePoints(event.target.value);
            if (Number.isFinite(value)) {
              onChange({ ...draft, rewardPoints: value });
            }
          },
        })}
        {...(form.formState.errors.rewardPoints?.message
          ? { errorMessage: form.formState.errors.rewardPoints.message }
          : {})}
      />

      <Input
        label={t("campaignBuilder.reward.accuracyBonusLabel")}
        type="number"
        min={0}
        disabled={disabled}
        value={draft.accuracyBonusPoints}
        onChange={(event) => {
          const value = toWholePoints(event.target.value);
          if (Number.isFinite(value)) {
            onChange({ ...draft, accuracyBonusPoints: value });
          }
        }}
      />

      <NativeSelect
        label={t("campaignBuilder.reward.scoringRuleLabel")}
        id={scoringRuleId}
        value={draft.scoringRule}
        disabled={disabled}
        onChange={(event) =>
          // Safe: the <option> values below are drawn from
          // `scoringRuleLabels`'s own keys, which are exactly
          // `CampaignScoringRule`'s two members.
          onChange({ ...draft, scoringRule: event.target.value as CampaignScoringRule })
        }
      >
        {(Object.keys(scoringRuleLabels) as CampaignScoringRule[]).map((rule) => (
          <option key={rule} value={rule}>
            {scoringRuleLabels[rule]}
          </option>
        ))}
      </NativeSelect>

      {isLiveMode ? (
        <>
          <NativeSelect
            label={t("campaignBuilder.reward.allocationLabel")}
            id={allocationSelectId}
            value={draft.allocationId ?? ""}
            disabled={disabled || allocations.length === 0}
            onChange={(event) => onChange({ ...draft, allocationId: event.target.value || null })}
          >
            <option value="" disabled>
              {allocations.length === 0
                ? t("campaignBuilder.reward.allocationNone")
                : t("campaignBuilder.reward.allocationLabel")}
            </option>
            {allocations.map((allocation) => (
              <option key={allocation.allocationId} value={allocation.allocationId}>
                {t("campaignBuilder.reward.allocationOption", {
                  points: allocation.remainingPoints,
                  shortId: allocation.allocationId.slice(0, 8),
                })}
              </option>
            ))}
          </NativeSelect>

          {saveState.status === "error" ? (
            <p role="alert" className="text-xs font-sans text-danger">
              {saveState.message}
            </p>
          ) : null}

          {draft.rewardValueMinorUnits !== null && draft.rewardCurrency ? (
            <p className="text-xs font-sans text-fg-muted">
              {t("campaignBuilder.reward.rewardValueLabel")}:{" "}
              <MoneyAmount
                amountMinor={draft.rewardValueMinorUnits}
                currency={draft.rewardCurrency as "AUD" | "IDR"}
              />
            </p>
          ) : null}

          <Button
            type="button"
            size="sm"
            className="w-fit"
            disabled={disabled || saveState.status === "saving"}
            onClick={() => void saveReward()}
          >
            {t("campaignBuilder.reward.saveReward")}
          </Button>
        </>
      ) : null}

      <div className="flex items-start gap-2 rounded-md bg-surface-raised px-3 py-2">
        <Badge
          variant={
            assessment.meetsGuideline === null
              ? "secondary"
              : assessment.meetsGuideline
                ? "success"
                : "danger"
          }
          className="shrink-0"
        >
          {assessment.meetsGuideline === null
            ? t("campaignBuilder.reward.ratioPending")
            : assessment.meetsGuideline
              ? t("campaignBuilder.reward.fairTrade")
              : t("campaignBuilder.reward.rewardTooSmall")}
        </Badge>
        <p className="text-xs font-sans text-fg-muted">
          {describeRewardDataCostRatio(assessment, t)}
        </p>
      </div>
    </div>
  );
}
