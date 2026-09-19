"use client";

import type { TrueFalseQuestionDraft } from "./question-draft";

export interface TrueFalseFieldsProps {
  draft: TrueFalseQuestionDraft;
  onChange: (draft: TrueFalseQuestionDraft) => void;
}

/** The true_false-specific authoring field: which answer is correct. */
export function TrueFalseFields({ draft, onChange }: TrueFalseFieldsProps) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-sans font-medium text-fg">Correct answer</legend>
      <div className="flex gap-4">
        {(
          [
            { value: true, label: "True" },
            { value: false, label: "False" },
          ] as const
        ).map((option) => (
          <label
            key={String(option.value)}
            className="flex items-center gap-2 text-sm font-sans text-fg"
          >
            <input
              type="radio"
              name={`correct-${draft.id}`}
              checked={draft.correctAnswer === option.value}
              onChange={() => onChange({ ...draft, correctAnswer: option.value })}
              className="h-4 w-4 accent-primary"
            />
            {option.label}
          </label>
        ))}
      </div>
      {draft.correctAnswer === null ? (
        <p role="alert" className="text-xs font-sans text-danger">
          Mark whether the correct answer is true or false before saving this question.
        </p>
      ) : null}
    </fieldset>
  );
}
