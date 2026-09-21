"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
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

export function TrueFalseQuestionView({
  question,
  respondentId,
  answer,
  onAnswerChange,
  promptId,
  disabled = false,
}: TrueFalseQuestionViewProps) {
  const t = useTranslations("checkpoint");
  const trueFalseOptions = useMemo(
    () => [
      { id: "true", label: t("question.trueFalse.true") },
      { id: "false", label: t("question.trueFalse.false") },
    ],
    [t],
  );
  const shuffledOptions = useMemo(
    () => seededShuffle(trueFalseOptions, [question.campaignId, question.id, respondentId]),
    [question.campaignId, question.id, respondentId, trueFalseOptions],
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
