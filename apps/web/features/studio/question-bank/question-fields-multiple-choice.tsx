"use client";

import { useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import { Input } from "@yourtal/ui/input";
import type { MultipleChoiceQuestionDraft } from "./question-draft";

export interface MultipleChoiceFieldsProps {
  draft: MultipleChoiceQuestionDraft;
  onChange: (draft: MultipleChoiceQuestionDraft) => void;
}

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

/**
 * The multiple_choice-specific authoring fields: options plus which one is
 * correct (docs/tasks/phase-u-ui.md YT-0442: "correct-answer marking on
 * scored types"). Each option row is a real accessible radio paired with
 * its own editable label — unlike the checkpoint's answer-time
 * `RadioQuestionGroup`, which renders a fixed label as static text, here
 * the label itself is what the author is editing, so the two controls
 * cannot share that component.
 */
export function MultipleChoiceFields({ draft, onChange }: MultipleChoiceFieldsProps) {
  const t = useTranslations("studio");
  function updateOption(optionId: string, label: string) {
    onChange({
      ...draft,
      options: draft.options.map((option) =>
        option.id === optionId ? { ...option, label } : option,
      ),
    });
  }

  function addOption() {
    if (draft.options.length >= MAX_OPTIONS) {
      return;
    }
    onChange({ ...draft, options: [...draft.options, { id: crypto.randomUUID(), label: "" }] });
  }

  function removeOption(optionId: string) {
    if (draft.options.length <= MIN_OPTIONS) {
      return;
    }
    const options = draft.options.filter((option) => option.id !== optionId);
    const correctOptionId = draft.correctOptionId === optionId ? null : draft.correctOptionId;
    onChange({ ...draft, options, correctOptionId });
  }

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-sans font-medium text-fg">
        {t("questionBank.multipleChoice.legend")}
      </legend>
      {draft.options.map((option, index) => (
        <div key={option.id} className="flex items-end gap-2">
          <Input
            type="radio"
            name={`correct-${draft.id}`}
            label={t("questionBank.multipleChoice.markCorrect", { number: index + 1 })}
            hideLabel
            checked={draft.correctOptionId === option.id}
            onChange={() => onChange({ ...draft, correctOptionId: option.id })}
            className="h-4 w-4 shrink-0 rounded-none border-0 bg-transparent p-0 accent-primary"
          />
          <div className="flex-1">
            <Input
              label={t("questionBank.multipleChoice.optionLabel", { number: index + 1 })}
              hideLabel
              placeholder={t("questionBank.multipleChoice.optionLabel", { number: index + 1 })}
              value={option.label}
              onChange={(event) => updateOption(option.id, event.target.value)}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => removeOption(option.id)}
            disabled={draft.options.length <= MIN_OPTIONS}
            aria-label={t("questionBank.multipleChoice.removeOption", { number: index + 1 })}
          >
            {t("questionBank.multipleChoice.remove")}
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={addOption}
        disabled={draft.options.length >= MAX_OPTIONS}
      >
        {t("questionBank.multipleChoice.addOption")}
      </Button>
      {draft.options.length >= MIN_OPTIONS && !draft.correctOptionId ? (
        <p role="alert" className="text-xs font-sans text-danger">
          {t("questionBank.multipleChoice.markCorrectWarning")}
        </p>
      ) : null}
    </fieldset>
  );
}
