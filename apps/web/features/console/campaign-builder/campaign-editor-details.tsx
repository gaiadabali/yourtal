"use client";

import { useId } from "react";
import { Input } from "@yourtal/ui/input";
import { cn } from "@yourtal/ui/cn";
import type { CampaignDraft, CampaignDraftFieldErrors } from "./campaign-draft";

export interface CampaignEditorDetailsProps {
  draft: CampaignDraft;
  fieldErrors: CampaignDraftFieldErrors;
  onChange: (draft: CampaignDraft) => void;
  disabled?: boolean;
}

const MAX_SYNOPSIS_LENGTH = 500;

/**
 * Title and synopsis — the two fields the entry-card preview renders
 * verbatim (`campaign-entry-preview.tsx`), so a change here is visible in
 * the preview immediately. There is no `Textarea` primitive in
 * `packages/ui` (YT-0401's list is Button/Input/Select/Card/Sheet/Dialog/
 * Toast/Skeleton/Tabs/Badge/Progress only), so the synopsis field is a
 * small local textarea styled to match `Input`'s own classes — the same
 * "build the missing primitive locally" call
 * `features/checkpoint/questions/radio-question-group.tsx` already made
 * for the missing radio-group primitive.
 */
export function CampaignEditorDetails({
  draft,
  fieldErrors,
  onChange,
  disabled,
}: CampaignEditorDetailsProps) {
  const synopsisId = useId();
  const synopsisHelpId = `${synopsisId}-help`;
  const synopsisErrorId = `${synopsisId}-error`;
  const remaining = MAX_SYNOPSIS_LENGTH - draft.synopsis.length;

  return (
    <div className="flex flex-col gap-4">
      <Input
        label="Campaign title"
        value={draft.title}
        disabled={disabled}
        onChange={(event) => onChange({ ...draft, title: event.target.value })}
        {...(fieldErrors.title ? { errorMessage: fieldErrors.title } : {})}
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor={synopsisId} className="text-sm font-sans font-medium text-fg">
          Synopsis
        </label>
        <textarea
          id={synopsisId}
          value={draft.synopsis}
          disabled={disabled}
          maxLength={MAX_SYNOPSIS_LENGTH}
          rows={3}
          aria-describedby={fieldErrors.synopsis ? synopsisErrorId : synopsisHelpId}
          aria-invalid={fieldErrors.synopsis ? true : undefined}
          onChange={(event) => onChange({ ...draft, synopsis: event.target.value })}
          className={cn(
            "w-full min-w-0 rounded-md border border-border bg-surface px-3 py-2 text-sm font-sans text-fg",
            "placeholder:text-fg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
            fieldErrors.synopsis && "border-danger",
          )}
        />
        {fieldErrors.synopsis ? (
          <p id={synopsisErrorId} role="alert" className="text-xs font-sans text-danger">
            {fieldErrors.synopsis}
          </p>
        ) : (
          <p id={synopsisHelpId} className="text-xs font-sans text-fg-muted">
            This is what the viewer reads before starting — {remaining} characters left.
          </p>
        )}
      </div>
    </div>
  );
}
