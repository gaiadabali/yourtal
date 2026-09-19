"use client";

import type { ChangeEvent } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Input } from "@yourtal/ui/input";
import type { CampaignBudget, CampaignDraftFormValues } from "./campaign-draft";

export interface CampaignEditorBudgetProps {
  budget: CampaignBudget;
  form: UseFormReturn<CampaignDraftFormValues>;
  onChange: (budget: CampaignBudget) => void;
  disabled?: boolean;
}

/** A whole number of points, positive or negative — see the matching helper's comment in `campaign-editor-reward.tsx`: the non-positive check now lives in `campaign-draft.ts`'s validator and actually fires, instead of a clamp silently rewriting the value. */
function toWholePoints(raw: string): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.round(parsed) : NaN;
}

/**
 * Total budget and an optional daily cap, in points — the pool this campaign
 * draws reward payouts from (docs/17 §2's Campaigns zone: "budget, point
 * allocation"). A daily cap of null means uncapped, an explicit choice, not
 * a default nobody made.
 *
 * `totalBudgetPoints` is registered on the shared `form` (YT-0525 — see
 * `campaign-editor.tsx`'s doc comment); `dailyCapPoints` stays a plain
 * controlled field via `budget`/`onChange` since it is not one of the four
 * fields `campaign-draft.ts`'s validator covers.
 */
export function CampaignEditorBudget({
  budget,
  form,
  onChange,
  disabled,
}: CampaignEditorBudgetProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      <div className="flex-1">
        <Input
          label="Total budget (points)"
          type="number"
          min={0}
          disabled={disabled}
          {...form.register("totalBudgetPoints", {
            setValueAs: toWholePoints,
            onChange: (event: ChangeEvent<HTMLInputElement>) => {
              const value = toWholePoints(event.target.value);
              if (Number.isFinite(value)) {
                onChange({ ...budget, totalBudgetPoints: value });
              }
            },
          })}
          {...(form.formState.errors.totalBudgetPoints?.message
            ? { errorMessage: form.formState.errors.totalBudgetPoints.message }
            : {})}
        />
      </div>
      <div className="flex-1">
        <Input
          label="Daily cap (points, optional)"
          type="number"
          min={0}
          value={budget.dailyCapPoints ?? ""}
          disabled={disabled}
          placeholder="No daily cap"
          onChange={(event) => {
            const raw = event.target.value;
            if (raw.trim().length === 0) {
              onChange({ ...budget, dailyCapPoints: null });
              return;
            }
            const parsed = Number(raw);
            if (Number.isFinite(parsed)) {
              onChange({ ...budget, dailyCapPoints: Math.max(0, Math.round(parsed)) });
            }
          }}
        />
      </div>
    </div>
  );
}
