"use client";

import type { ChangeEvent } from "react";
import { useId } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { UseFormReturn } from "react-hook-form";
import type { BillingAllocation } from "@yourtal/contracts/billing";
import { Badge } from "@yourtal/ui/badge";
import { Button } from "@yourtal/ui/button";
import { Input } from "@yourtal/ui/input";
import { MoneyAmount } from "@yourtal/ui/money-amount";
import { NativeSelect } from "@yourtal/ui/native-select";
import type { CampaignScoringRule } from "@yourtal/contracts/campaign";
import { useRegion } from "@/features/region/use-region";
import { rewardRatioText, rewardRatioView } from "./campaign-reward-risk";
import { draftRewardUnsaved } from "./campaign-reward-patch";
import type { RewardConfigSave } from "./use-reward-config-save";
import { fundingOptions } from "./campaign-funding-label";
import type { CampaignDraft, CampaignDraftFormValues } from "./campaign-draft";
import {
  campaignFormErrorText,
  draftDurationPending,
  draftEstimatedDataMb,
} from "./campaign-draft";

export interface CampaignEditorRewardProps {
  draft: CampaignDraft;
  form: UseFormReturn<CampaignDraftFormValues>;
  onChange: (draft: CampaignDraft) => void;
  /** The reward-and-budget save the editor owns, shared with the Budget tab. */
  rewardSave: RewardConfigSave;
  disabled?: boolean;
  isLiveMode: boolean;
  /** The partner allocations a reward may draw from (`GET .../studio/campaign-funding`, 7.3.c, 13.3.b). */
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
  rewardSave,
  disabled,
  isLiveMode,
  allocations,
}: CampaignEditorRewardProps) {
  const t = useTranslations("studio");
  const locale = useLocale();
  const scoringRuleId = useId();
  const allocationSelectId = useId();
  const { currency, region } = useRegion();
  const estimatedDataMb = draftEstimatedDataMb(draft);
  const saveState = rewardSave.state;
  const hasBonus = draft.scoringRule === "base_plus_accuracy_bonus";
  const unsaved = draftRewardUnsaved(draft);

  /** Any edit makes a shown refusal or "saved" stale. */
  function edit(next: CampaignDraft) {
    rewardSave.clear();
    onChange(next);
  }
  const scoringRuleLabels: Record<CampaignScoringRule, string> = {
    base_only: t("campaignBuilder.reward.scoringRuleBaseOnly"),
    base_plus_accuracy_bonus: t("campaignBuilder.reward.scoringRuleBaseBonus"),
  };
  // Live: the server's own priced value from the last successful
  // `PUT .../reward` this session (7.3.h). `null` until then, or always in
  // mock mode — see `campaign-reward-risk.ts`'s own doc comment. The preview
  // card reads the same view, so the two never disagree.
  const ratio = rewardRatioView({
    rewardPoints: draft.rewardPoints,
    rewardValueMinorUnits: draft.rewardValueMinorUnits,
    estimatedDataMb,
    currency,
    durationPending: draftDurationPending(draft, isLiveMode),
    rewardUnsaved: unsaved,
  });
  const options = fundingOptions(allocations, locale, region, t);

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
              edit({ ...draft, rewardPoints: value });
            }
          },
        })}
        {...(form.formState.errors.rewardPoints?.message
          ? { errorMessage: campaignFormErrorText(t, form.formState.errors.rewardPoints.message) }
          : saveState.status === "error" && saveState.field === "rewardPoints"
            ? { errorMessage: saveState.message }
            : {})}
      />

      <NativeSelect
        label={t("campaignBuilder.reward.scoringRuleLabel")}
        id={scoringRuleId}
        value={draft.scoringRule}
        disabled={disabled}
        onChange={(event) => {
          // Safe: the <option> values below are drawn from
          // `scoringRuleLabels`'s own keys, which are exactly
          // `CampaignScoringRule`'s two members.
          const scoringRule = event.target.value as CampaignScoringRule;
          // A fixed reward has no bonus, so a number left in the field does not count.
          edit({
            ...draft,
            scoringRule,
            accuracyBonusPoints: scoringRule === "base_only" ? 0 : draft.accuracyBonusPoints,
          });
        }}
      >
        {(Object.keys(scoringRuleLabels) as CampaignScoringRule[]).map((rule) => (
          <option key={rule} value={rule}>
            {scoringRuleLabels[rule]}
          </option>
        ))}
      </NativeSelect>

      {hasBonus ? (
        <Input
          label={t("campaignBuilder.reward.accuracyBonusLabel")}
          type="number"
          min={0}
          disabled={disabled}
          value={draft.accuracyBonusPoints}
          onChange={(event) => {
            const value = toWholePoints(event.target.value);
            if (Number.isFinite(value)) {
              edit({ ...draft, accuracyBonusPoints: value });
            }
          }}
        />
      ) : null}

      {isLiveMode && draftDurationPending(draft, isLiveMode) ? (
        <p className="text-xs font-sans text-fg-muted">
          {t("campaignBuilder.reward.limitPendingNote")}
        </p>
      ) : null}

      {isLiveMode ? (
        <>
          <NativeSelect
            label={t("campaignBuilder.reward.allocationLabel")}
            id={allocationSelectId}
            value={draft.allocationId ?? ""}
            disabled={disabled || allocations.length === 0}
            onChange={(event) => edit({ ...draft, allocationId: event.target.value || null })}
            {...(saveState.status === "error" && saveState.field === "allocation"
              ? { errorMessage: saveState.message }
              : {})}
          >
            <option value="" disabled>
              {allocations.length === 0
                ? t("campaignBuilder.reward.allocationNone")
                : t("campaignBuilder.reward.allocationLabel")}
            </option>
            {options.map((option) => (
              <option key={option.allocationId} value={option.allocationId}>
                {option.label}
              </option>
            ))}
          </NativeSelect>

          {saveState.status === "error" && saveState.field === "save" ? (
            <p role="alert" className="text-xs font-sans text-danger">
              {saveState.message}
            </p>
          ) : null}
          {saveState.status === "saved" ? (
            <p role="status" className="text-xs font-sans text-fg-muted">
              {t("campaignBuilder.reward.rewardSaved")}
            </p>
          ) : null}
          {unsaved && saveState.status !== "saved" ? (
            <p className="text-xs font-sans text-fg-muted">
              {t("campaignBuilder.reward.unsavedNote")}
            </p>
          ) : null}

          {draft.rewardValueMinorUnits !== null && draft.rewardCurrency ? (
            <p className="text-xs font-sans text-fg-muted">
              {t("campaignBuilder.reward.rewardValueLabel")}:{" "}
              <MoneyAmount
                amountMinor={draft.rewardValueMinorUnits}
                currency={draft.rewardCurrency as "AUD" | "IDR"}
                locale={locale}
              />
            </p>
          ) : null}

          <Button
            type="button"
            size="sm"
            className="w-fit"
            disabled={disabled || saveState.status === "saving"}
            onClick={() => void rewardSave.save()}
          >
            {t("campaignBuilder.reward.saveReward")}
          </Button>
        </>
      ) : null}

      <div className="flex items-start gap-2 rounded-md bg-surface-raised px-3 py-2">
        <Badge
          variant={
            ratio.note === "meetsGuideline" || ratio.note === "noDataCost"
              ? "success"
              : ratio.note === "belowGuideline"
                ? "warning"
                : "secondary"
          }
          className="shrink-0"
        >
          {ratio.note === "meetsGuideline" || ratio.note === "noDataCost"
            ? t("campaignBuilder.reward.fairTrade")
            : ratio.note === "belowGuideline"
              ? t("campaignBuilder.reward.rewardTooSmall")
              : t("campaignBuilder.reward.ratioPending")}
        </Badge>
        <p className="text-xs font-sans text-fg-muted">{rewardRatioText(ratio, t)}</p>
      </div>
    </div>
  );
}
