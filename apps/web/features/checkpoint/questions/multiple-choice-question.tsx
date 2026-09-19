"use client";

import { useMemo } from "react";
import type { MultipleChoiceQuestion } from "@yourtal/contracts/question";
import type { MultipleChoiceAnswer } from "../checkpoint-types";
import { seededShuffle } from "../checkpoint-seeded-shuffle";
import { RadioQuestionGroup } from "./radio-question-group";

export interface MultipleChoiceQuestionViewProps {
  question: MultipleChoiceQuestion;
  respondentId: string;
  answer: MultipleChoiceAnswer | undefined;
  onAnswerChange: (answer: MultipleChoiceAnswer) => void;
  promptId: string;
  disabled?: boolean;
}

export function MultipleChoiceQuestionView({
  question,
  respondentId,
  answer,
  onAnswerChange,
  promptId,
  disabled = false,
}: MultipleChoiceQuestionViewProps) {
  const shuffledOptions = useMemo(
    () => seededShuffle(question.options, [question.campaignId, question.id, respondentId]),
    [question.campaignId, question.id, question.options, respondentId],
  );

  return (
    <RadioQuestionGroup
      options={shuffledOptions}
      value={answer?.selectedOptionId}
      onValueChange={(selectedOptionId) => onAnswerChange({ type: "multiple_choice", selectedOptionId })}
      ariaLabelledBy={promptId}
      name={`question-${question.id}`}
      disabled={disabled}
    />
  );
}
