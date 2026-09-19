"use client";

import type { ChangeEvent } from "react";
import { useId } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Badge } from "@yourtal/ui/badge";
import { Input } from "@yourtal/ui/input";
import type { CampaignScoringRule } from "@yourtal/contracts/campaign";
import { useRegion } from "@/features/region/use-region";
import { assessRewardToDataCost, describeRewardDataCostRatio } from "./campaign-reward-risk";
import type { CampaignDraft, CampaignDraftFormValues } from "./campaign-draft";
import { draftEstimatedDataMb } from "./campaign-draft";

export interface CampaignEditorRewardProps {
  draft: CampaignDraft;
  form: UseFormReturn<CampaignDraftFormValues>;
  onChange: (draft: CampaignDraft) => void;
  disabled?: boolean;
}

const SCORING_RULE_LABELS: Record<CampaignScoringRule, string> = {
  base_only: "Fixed reward — same for every viewer who watches and answers",
  base_plus_accuracy_bonus: "Base + accuracy bonus — scales up to 40% more for correct answers",
};

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
}: CampaignEditorRewardProps) {
  const scoringRuleId = useId();
  const { currency } = useRegion();
  const rewardPoints = form.watch("rewardPoints");
  const estimatedDataMb = draftEstimatedDataMb(draft);
  const assessment = assessRewardToDataCost(rewardPoints, estimatedDataMb, currency);

  return (
    <div className="flex flex-col gap-4">
      <Input
        label="Reward (points)"
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

      <div className="flex flex-col gap-1.5">
        <label htmlFor={scoringRuleId} className="text-sm font-sans font-medium text-fg">
          Scoring rule
        </label>
        <select
          id={scoringRuleId}
          value={draft.scoringRule}
          disabled={disabled}
          onChange={(event) =>
            // Safe: the <option> values below are drawn from
            // `SCORING_RULE_LABELS`'s own keys, which are exactly
            // `CampaignScoringRule`'s two members.
            onChange({ ...draft, scoringRule: event.target.value as CampaignScoringRule })
          }
          className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm font-sans text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {(Object.keys(SCORING_RULE_LABELS) as CampaignScoringRule[]).map((rule) => (
            <option key={rule} value={rule}>
              {SCORING_RULE_LABELS[rule]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-start gap-2 rounded-md bg-surface-raised px-3 py-2">
        <Badge variant={assessment.meetsGuideline ? "success" : "danger"} className="shrink-0">
          {assessment.meetsGuideline ? "Fair trade" : "Reward too small"}
        </Badge>
        <p className="text-xs font-sans text-fg-muted">{describeRewardDataCostRatio(assessment)}</p>
      </div>
    </div>
  );
}
