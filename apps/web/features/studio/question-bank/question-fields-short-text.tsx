"use client";

import { useTranslations } from "next-intl";
import { Input } from "@yourtal/ui/input";
import type { ShortTextQuestionDraft } from "./question-draft";

export interface ShortTextFieldsProps {
  draft: ShortTextQuestionDraft;
  onChange: (draft: ShortTextQuestionDraft) => void;
}

const MIN_LENGTH = 20;
const MAX_LENGTH = 500;

/** The short_text-specific authoring field: the answer's character cap. */
export function ShortTextFields({ draft, onChange }: ShortTextFieldsProps) {
  const t = useTranslations("studio");
  return (
    <Input
      label={t("questionBank.shortText.maxLengthLabel")}
      type="number"
      min={MIN_LENGTH}
      max={MAX_LENGTH}
      value={draft.maxLength}
      onChange={(event) => {
        const parsed = Number(event.target.value);
        if (Number.isFinite(parsed)) {
          onChange({
            ...draft,
            maxLength: Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, Math.round(parsed))),
          });
        }
      }}
      helpText={t("questionBank.shortText.help")}
    />
  );
}
