"use client";

import type { Question } from "@yourtal/contracts/question";
import type { QuestionAnswer } from "./checkpoint-types";
import { LikertQuestionView } from "./questions/likert-question";
import { MultipleChoiceQuestionView } from "./questions/multiple-choice-question";
import { RankedQuestionView } from "./questions/ranked-question";
import { ShortTextQuestionView } from "./questions/short-text-question";
import { TrueFalseQuestionView } from "./questions/true-false-question";

export interface QuestionAnswerViewProps {
  question: Question;
  respondentId: string;
  answer: QuestionAnswer | undefined;
  onAnswerChange: (answer: QuestionAnswer) => void;
  promptId: string;
  disabled?: boolean;
}

/**
 * The one place that maps a `Question` to its type-specific view. An
 * exhaustive `switch` with a `never` default (docs/13b-typescript-standards.md
 * section 4's discipline, applied here even though this isn't a
 * `neverthrow` error union) — adding a sixth question type to the
 * contracts package's discriminated union will fail this file's build
 * until a case is added for it, by design.
 */
export function QuestionAnswerView({
  question,
  respondentId,
  answer,
  onAnswerChange,
  promptId,
  disabled = false,
}: QuestionAnswerViewProps) {
  switch (question.type) {
    case "multiple_choice":
      return (
        <MultipleChoiceQuestionView
          question={question}
          respondentId={respondentId}
          answer={answer?.type === "multiple_choice" ? answer : undefined}
          onAnswerChange={onAnswerChange}
          promptId={promptId}
          disabled={disabled}
        />
      );
    case "true_false":
      return (
        <TrueFalseQuestionView
          question={question}
          respondentId={respondentId}
          answer={answer?.type === "true_false" ? answer : undefined}
          onAnswerChange={onAnswerChange}
          promptId={promptId}
          disabled={disabled}
        />
      );
    case "likert":
      return (
        <LikertQuestionView
          question={question}
          answer={answer?.type === "likert" ? answer : undefined}
          onAnswerChange={onAnswerChange}
          promptId={promptId}
          disabled={disabled}
        />
      );
    case "ranked":
      return (
        <RankedQuestionView
          question={question}
          respondentId={respondentId}
          answer={answer?.type === "ranked" ? answer : undefined}
          onAnswerChange={onAnswerChange}
          promptId={promptId}
          disabled={disabled}
        />
      );
    case "short_text":
      return (
        <ShortTextQuestionView
          question={question}
          answer={answer?.type === "short_text" ? answer : undefined}
          onAnswerChange={onAnswerChange}
          disabled={disabled}
        />
      );
    default: {
      const exhaustive: never = question;
      throw new Error(`Unhandled question type: ${JSON.stringify(exhaustive)}`);
    }
  }
}
