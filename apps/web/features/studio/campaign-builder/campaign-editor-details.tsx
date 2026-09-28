"use client";

import type { ChangeEvent } from "react";
import { useId } from "react";
import { useTranslations } from "next-intl";
import type { UseFormReturn } from "react-hook-form";
import { Input } from "@yourtal/ui/input";
import { NativeSelect } from "@yourtal/ui/native-select";
import { Switch } from "@yourtal/ui/switch";
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
 * Restated from `@yourtal/jurisdiction`'s own `contentCategorySchema` —
 * that package is not an `apps/web` dependency (this client-reachable
 * module must not pull in its Zod runtime), so the values are copied here
 * as plain strings, the same way `studio-roles.ts` restates
 * `businessTeamRoleSchema`'s members. The real enum is still enforced
 * server-side on every `PATCH`; a typo here fails loudly there, not
 * silently here.
 */
const CONTENT_CATEGORIES = [
  "food-and-drink",
  "fashion",
  "personal-care",
  "electronics",
  "telco",
  "transport",
  "fitness",
  "education",
  "travel",
  "home",
  "entertainment",
  "games",
  "books",
  "family",
  "toys",
  "digital-goods",
  "services",
  "tobacco",
  "vaping",
  "gambling",
  "alcohol",
  "dating",
  "financial-products",
  "weight-loss",
  "cosmetic-procedures",
  "energy-drinks",
] as const;

/** Restated from `@yourtal/contracts/campaign`'s `audienceSchema` — this module only ever `import type`s that package's schemas (see this file's own doc comment on why). */
const AUDIENCES = ["all_ages", "teen", "adult", "parents"] as const;

/** `YYYY-MM-DD` for a `type="date"` input from a full ISO datetime, and back — schedule fields are dates in this editor, never a time of day. */
function toDateInputValue(iso: string): string {
  return iso.slice(0, 10);
}
function fromDateInputValue(value: string): string {
  return new Date(`${value}T00:00:00.000Z`).toISOString();
}

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
  const t = useTranslations("studio");
  const synopsisId = useId();
  const synopsisHelpId = `${synopsisId}-help`;
  const synopsisErrorId = `${synopsisId}-error`;
  const synopsis = form.watch("synopsis");
  const synopsisError = form.formState.errors.synopsis?.message;
  const remaining = MAX_SYNOPSIS_LENGTH - synopsis.length;
  const categoryId = useId();
  const audienceId = useId();
  const audienceLabels: Record<(typeof AUDIENCES)[number], string> = {
    all_ages: t("campaignBuilder.details.audienceAllAges"),
    teen: t("campaignBuilder.details.audienceTeen"),
    adult: t("campaignBuilder.details.audienceAdult"),
    parents: t("campaignBuilder.details.audienceParents"),
  };

  return (
    <div className="flex flex-col gap-4">
      <Input
        label={t("campaignBuilder.details.titleLabel")}
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
          {t("campaignBuilder.details.synopsisLabel")}
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
            {t("campaignBuilder.details.synopsisHelp", { remaining })}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex-1">
          <NativeSelect
            label={t("campaignBuilder.details.categoryLabel")}
            id={categoryId}
            value={draft.contentCategory}
            disabled={disabled}
            onChange={(event) => onChange({ ...draft, contentCategory: event.target.value })}
          >
            {CONTENT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex-1">
          <NativeSelect
            label={t("campaignBuilder.details.audienceLabel")}
            id={audienceId}
            value={draft.audience}
            disabled={disabled}
            onChange={(event) => onChange({ ...draft, audience: event.target.value })}
          >
            {AUDIENCES.map((audience) => (
              <option key={audience} value={audience}>
                {audienceLabels[audience]}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex-1">
          <Input
            label={t("campaignBuilder.details.startsAtLabel")}
            type="date"
            disabled={disabled}
            value={toDateInputValue(draft.startsAt)}
            onChange={(event) =>
              onChange({ ...draft, startsAt: fromDateInputValue(event.target.value) })
            }
          />
        </div>
        <div className="flex-1">
          <Input
            label={t("campaignBuilder.details.endsAtLabel")}
            type="date"
            disabled={disabled}
            value={toDateInputValue(draft.endsAt)}
            onChange={(event) =>
              onChange({ ...draft, endsAt: fromDateInputValue(event.target.value) })
            }
          />
        </div>
      </div>

      <Switch
        label={t("campaignBuilder.details.openViewingLabel")}
        checked={draft.openViewing}
        disabled={disabled}
        onCheckedChange={(checked) => onChange({ ...draft, openViewing: checked })}
      />

      <Input
        label={t("campaignBuilder.details.teaserStartLabel")}
        type="number"
        min={0}
        disabled={disabled}
        value={draft.teaserStartSeconds}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (Number.isFinite(parsed) && parsed >= 0) {
            onChange({ ...draft, teaserStartSeconds: Math.round(parsed) });
          }
        }}
      />

      <Input
        label={t("campaignBuilder.details.captionsUrlLabel")}
        type="url"
        placeholder={t("campaignBuilder.details.captionsUrlPlaceholder")}
        disabled={disabled}
        value={draft.captionsUrl ?? ""}
        onChange={(event) => onChange({ ...draft, captionsUrl: event.target.value.trim() || null })}
      />
    </div>
  );
}
