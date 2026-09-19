"use client";

import { Input } from "@yourtal/ui/input";
import type { QuestionDraft } from "./question-draft";
import { detectPiiRequest } from "./question-pii-guard";
import { questionTypeScoreLabel, QUESTION_TYPE_LABELS } from "./question-type-catalog";
import { LikertFields } from "./question-fields-likert";
import { MultipleChoiceFields } from "./question-fields-multiple-choice";
import { RankedFields } from "./question-fields-ranked";
import { ShortTextFields } from "./question-fields-short-text";
import { TrueFalseFields } from "./question-fields-true-false";

export interface QuestionEditorProps {
  draft: QuestionDraft;
  onChange: (draft: QuestionDraft) => void;
}

const MIN_TIMER_SECONDS = 10;
const MAX_TIMER_SECONDS = 120;

/**
 * The shared authoring shell for one question — prompt, timer, and the
 * live PII guard (docs/tasks/phase-u-ui.md YT-0442: "shown inline as the
 * author types, with the reason") — plus the type-specific fields below it,
 * dispatched by an exhaustive `switch` with a `never` default
 * (docs/13b-typescript-standards.md §4's discipline; this ticket's brief
 * asks for it explicitly). Mirrors the shared-shell/per-type-view split in
 * `features/checkpoint/checkpoint-question-step.tsx` /
 * `question-answer-view.tsx` — the same content, viewed from the authoring
 * side instead of the answering side.
 */
export function QuestionEditor({ draft, onChange }: QuestionEditorProps) {
  const piiFinding = detectPiiRequest(draft.prompt);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-sans font-medium text-fg-subtle">
          {QUESTION_TYPE_LABELS[draft.type]}
        </span>
        <span className="text-xs font-sans text-fg-subtle">
          {questionTypeScoreLabel(draft.type)}
        </span>
      </div>

      <Input
        label="Question prompt"
        value={draft.prompt}
        onChange={(event) => onChange({ ...draft, prompt: event.target.value })}
        {...(piiFinding
          ? { errorMessage: `Can't ask for a ${piiFinding.category}: ${piiFinding.reason}` }
          : {})}
      />

      <Input
        label="Timer (seconds)"
        type="number"
        min={MIN_TIMER_SECONDS}
        max={MAX_TIMER_SECONDS}
        value={draft.timerSeconds}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (Number.isFinite(parsed)) {
            onChange({
              ...draft,
              timerSeconds: Math.min(
                MAX_TIMER_SECONDS,
                Math.max(MIN_TIMER_SECONDS, Math.round(parsed)),
              ),
            });
          }
        }}
        helpText="Ample for a viewer who watched, tight for looking an answer up (docs/06 §4.3)."
      />

      {renderTypeFields(draft, onChange)}
    </div>
  );
}

function renderTypeFields(draft: QuestionDraft, onChange: (draft: QuestionDraft) => void) {
  switch (draft.type) {
    case "multiple_choice":
      return <MultipleChoiceFields draft={draft} onChange={onChange} />;
    case "true_false":
      return <TrueFalseFields draft={draft} onChange={onChange} />;
    case "likert":
      return <LikertFields draft={draft} onChange={onChange} />;
    case "ranked":
      return <RankedFields draft={draft} onChange={onChange} />;
    case "short_text":
      return <ShortTextFields draft={draft} onChange={onChange} />;
    default: {
      const exhaustive: never = draft;
      throw new Error(`Unhandled question draft type: ${JSON.stringify(exhaustive)}`);
    }
  }
}
