"use client";

import { Input } from "@yourtal/ui/input";
import type { CampaignBudget, CampaignDraftFieldErrors } from "./campaign-draft";

export interface CampaignEditorBudgetProps {
  budget: CampaignBudget;
  fieldErrors: CampaignDraftFieldErrors;
  onChange: (budget: CampaignBudget) => void;
  disabled?: boolean;
}

/** Total budget and an optional daily cap, in points — the pool this campaign draws reward payouts from (docs/17 §2's Campaigns zone: "budget, point allocation"). A daily cap of null means uncapped, an explicit choice, not a default nobody made. */
export function CampaignEditorBudget({
  budget,
  fieldErrors,
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
          value={budget.totalBudgetPoints}
          disabled={disabled}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            if (Number.isFinite(parsed)) {
              onChange({ ...budget, totalBudgetPoints: Math.max(0, Math.round(parsed)) });
            }
          }}
          {...(fieldErrors.totalBudgetPoints
            ? { errorMessage: fieldErrors.totalBudgetPoints }
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
