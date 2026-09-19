"use client";

import { Input } from "@yourtal/ui/input";
import type { ShortTextQuestion } from "@yourtal/contracts/question";
import type { ShortTextAnswer } from "../checkpoint-types";

export interface ShortTextQuestionViewProps {
  question: ShortTextQuestion;
  answer: ShortTextAnswer | undefined;
  onAnswerChange: (answer: ShortTextAnswer) => void;
  disabled?: boolean;
}

/**
 * Free text is optional and never scored for correctness (docs/06
 * section 4.1: "sampled for reporting"), so unlike the other four types
 * this one needs no `promptId` wiring — `@yourtal/ui/input` renders its
 * own real `<label>`, which is its accessible name by design.
 */
export function ShortTextQuestionView({ question, answer, onAnswerChange, disabled }: ShortTextQuestionViewProps) {
  const text = answer?.text ?? "";
  const remaining = question.maxLength - text.length;

  return (
    <Input
      label="Jawaban Anda (opsional)"
      value={text}
      maxLength={question.maxLength}
      disabled={disabled}
      helpText={`${remaining} karakter tersisa`}
      onChange={(event) => onAnswerChange({ type: "short_text", text: event.target.value })}
    />
  );
}
