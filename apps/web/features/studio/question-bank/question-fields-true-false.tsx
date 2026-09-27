"use client";

import { useTranslations } from "next-intl";
import { Input } from "@yourtal/ui/input";
import type { TrueFalseQuestionDraft } from "./question-draft";

export interface TrueFalseFieldsProps {
  draft: TrueFalseQuestionDraft;
  onChange: (draft: TrueFalseQuestionDraft) => void;
}

/** The true_false-specific authoring field: which answer is correct. */
export function TrueFalseFields({ draft, onChange }: TrueFalseFieldsProps) {
  const t = useTranslations("studio");
  const options = [
    { value: true, label: t("questionBank.trueFalse.true") },
    { value: false, label: t("questionBank.trueFalse.false") },
  ] as const;

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-sans font-medium text-fg">
        {t("questionBank.trueFalse.legend")}
      </legend>
      <div className="flex gap-4">
        {options.map((option) => (
          <Input
            key={String(option.value)}
            type="radio"
            name={`correct-${draft.id}`}
            label={option.label}
            checked={draft.correctAnswer === option.value}
            onChange={() => onChange({ ...draft, correctAnswer: option.value })}
            className="h-4 w-4 shrink-0 rounded-none border-0 bg-transparent p-0 accent-primary"
          />
        ))}
      </div>
      {draft.correctAnswer === null ? (
        <p role="alert" className="text-xs font-sans text-danger">
          {t("questionBank.trueFalse.markWarning")}
        </p>
      ) : null}
    </fieldset>
  );
}
