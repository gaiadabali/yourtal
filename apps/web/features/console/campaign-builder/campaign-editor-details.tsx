"use client";

import type { ChangeEvent } from "react";
import { useId } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Input } from "@yourtal/ui/input";
import { cn } from "@yourtal/ui/cn";
import type { CampaignDraft, CampaignDraftFormValues } from "./campaign-draft";

export interface CampaignEditorDetailsProps {
  draft: CampaignDraft;
  form: UseFormReturn<CampaignDraftFormValues>;
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
 *
 * Both fields are registered on `form` (YT-0525's React Hook Form
 * migration, one instance per editor — see `campaign-editor.tsx`'s doc
 * comment). `register`'s own `onChange` option, not a `watch` subscription,
 * is what feeds `draft` back to the parent: it fires synchronously with the
 * keystroke RHF already recorded, so the live preview and RHF's own
 * validation state never disagree about which edit happened first.
 */
export function CampaignEditorDetails({
  draft,
  form,
  onChange,
  disabled,
}: CampaignEditorDetailsProps) {
  const synopsisId = useId();
  const synopsisHelpId = `${synopsisId}-help`;
  const synopsisErrorId = `${synopsisId}-error`;
  const synopsis = form.watch("synopsis");
  const synopsisError = form.formState.errors.synopsis?.message;
  const remaining = MAX_SYNOPSIS_LENGTH - synopsis.length;

  return (
    <div className="flex flex-col gap-4">
      <Input
        label="Campaign title"
        disabled={disabled}
        {...form.register("title", {
          onChange: (event: ChangeEvent<HTMLInputElement>) =>
            onChange({ ...draft, title: event.target.value }),
        })}
        {...(form.formState.errors.title?.message
          ? { errorMessage: form.formState.errors.title.message }
          : {})}
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor={synopsisId} className="text-sm font-sans font-medium text-fg">
          Synopsis
        </label>
        <textarea
          id={synopsisId}
          disabled={disabled}
          maxLength={MAX_SYNOPSIS_LENGTH}
          rows={3}
          aria-describedby={synopsisError ? synopsisErrorId : synopsisHelpId}
          aria-invalid={synopsisError ? true : undefined}
          {...form.register("synopsis", {
            onChange: (event: ChangeEvent<HTMLTextAreaElement>) =>
              onChange({ ...draft, synopsis: event.target.value }),
          })}
          className={cn(
            "w-full min-w-0 rounded-md border border-border bg-surface px-3 py-2 text-sm font-sans text-fg",
            "placeholder:text-fg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
            synopsisError && "border-danger",
          )}
        />
        {synopsisError ? (
          <p id={synopsisErrorId} role="alert" className="text-xs font-sans text-danger">
            {synopsisError}
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
