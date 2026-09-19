"use client";

import type { LikertQuestion } from "@yourtal/contracts/question";
import type { LikertAnswer } from "../checkpoint-types";
import { RadioQuestionGroup } from "./radio-question-group";

export interface LikertQuestionViewProps {
  question: LikertQuestion;
  answer: LikertAnswer | undefined;
  onAnswerChange: (answer: LikertAnswer) => void;
  promptId: string;
  disabled?: boolean;
}

/**
 * Likert scale order is semantically meaningful (low to high), so — unlike
 * the other option-bearing question types — this view deliberately does
 * NOT run its options through `seededShuffle`. Shuffling a satisfaction
 * scale would make it unreadable rather than more resistant to sharing;
 * the anti-sharing value of shuffling comes from option sets with no
 * inherent order, which a Likert scale is not.
 *
 * The endpoints carry their label text ("1 - Sangat tidak puas"), not a
 * bare number, per this ticket's acceptance detail; the interior values
 * are plain numbers since they have no distinct label to attach.
 */
export function LikertQuestionView({ question, answer, onAnswerChange, promptId, disabled = false }: LikertQuestionViewProps) {
  const options = [];
  for (let value = question.scaleMin; value <= question.scaleMax; value += 1) {
    const label =
      value === question.scaleMin
        ? `${value} - ${question.scaleLowLabel}`
        : value === question.scaleMax
          ? `${value} - ${question.scaleHighLabel}`
          : String(value);
    options.push({ id: String(value), label });
  }

  return (
    <RadioQuestionGroup
      options={options}
      value={answer ? String(answer.value) : undefined}
      onValueChange={(value) => onAnswerChange({ type: "likert", value: Number(value) })}
      ariaLabelledBy={promptId}
      name={`question-${question.id}`}
      disabled={disabled}
    />
  );
}
