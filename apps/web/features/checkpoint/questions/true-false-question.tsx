"use client";

import { useMemo } from "react";
import type { TrueFalseQuestion } from "@yourtal/contracts/question";
import type { TrueFalseAnswer } from "../checkpoint-types";
import { seededShuffle } from "../checkpoint-seeded-shuffle";
import { RadioQuestionGroup } from "./radio-question-group";

export interface TrueFalseQuestionViewProps {
  question: TrueFalseQuestion;
  respondentId: string;
  answer: TrueFalseAnswer | undefined;
  onAnswerChange: (answer: TrueFalseAnswer) => void;
  promptId: string;
  disabled?: boolean;
}

const TRUE_FALSE_OPTIONS = [
  { id: "true", label: "Benar" },
  { id: "false", label: "Salah" },
];

export function TrueFalseQuestionView({
  question,
  respondentId,
  answer,
  onAnswerChange,
  promptId,
  disabled = false,
}: TrueFalseQuestionViewProps) {
  const shuffledOptions = useMemo(
    () => seededShuffle(TRUE_FALSE_OPTIONS, [question.campaignId, question.id, respondentId]),
    [question.campaignId, question.id, respondentId],
  );

  return (
    <RadioQuestionGroup
      options={shuffledOptions}
      value={answer ? String(answer.value) : undefined}
      onValueChange={(value) => onAnswerChange({ type: "true_false", value: value === "true" })}
      ariaLabelledBy={promptId}
      name={`question-${question.id}`}
      disabled={disabled}
    />
  );
}
