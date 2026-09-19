"use client";

import { Button } from "@yourtal/ui/button";
import { Card, CardContent } from "@yourtal/ui/card";
import type { QuestionDraftType } from "./question-draft";
import { QUESTION_TYPES } from "./question-draft";
import {
  QUESTION_TYPE_DESCRIPTIONS,
  QUESTION_TYPE_LABELS,
  questionTypeScoreLabel,
} from "./question-type-catalog";

export interface QuestionTypePickerProps {
  onPick: (type: QuestionDraftType) => void;
}

/** Presents all five question types with the docs/06 §4.1 table's own wording, so the author picks by what the question is for, not a bare enum name. */
export function QuestionTypePicker({ onPick }: QuestionTypePickerProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {QUESTION_TYPES.map((type) => (
        <Card key={type}>
          <CardContent className="flex flex-col gap-2 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-sans font-semibold text-fg">
                {QUESTION_TYPE_LABELS[type]}
              </span>
              <span className="text-xs font-sans text-fg-subtle">
                {questionTypeScoreLabel(type)}
              </span>
            </div>
            <p className="text-xs font-sans text-fg-muted">{QUESTION_TYPE_DESCRIPTIONS[type]}</p>
            <Button type="button" variant="secondary" size="sm" onClick={() => onPick(type)}>
              Add {QUESTION_TYPE_LABELS[type].toLowerCase()}
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
