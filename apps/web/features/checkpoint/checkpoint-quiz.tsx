"use client";

import { useState } from "react";
import type { Campaign } from "@yourtal/contracts/campaign";
import type { Question } from "@yourtal/contracts/question";
import { CheckpointQuestionStep } from "./checkpoint-question-step";
import { CheckpointResult } from "./checkpoint-result";
import type { QuestionAnswer } from "./checkpoint-types";

/**
 * Stands in for a real respondent id until auth/session lands in this app.
 * The shuffle in `checkpoint-seeded-shuffle.ts` is genuinely per-respondent
 * (see its tests), but there is no authenticated user in this ticket's
 * scope to source a real id from — swapping this constant for the session
 * user's id is the entire migration once that context exists.
 */
const MOCK_RESPONDENT_ID = "mock-respondent";

export interface CheckpointQuizProps {
  campaign: Campaign;
  questions: Question[];
  respondentId?: string;
}

/** One question at a time, then the result screen. The client leaf of the checkpoint route (docs/13b-typescript-standards.md section 8). */
export function CheckpointQuiz({
  campaign,
  questions,
  respondentId = MOCK_RESPONDENT_ID,
}: CheckpointQuizProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<ReadonlyMap<string, QuestionAnswer>>(new Map());
  const [isComplete, setIsComplete] = useState(questions.length === 0);

  const currentQuestion = questions[currentIndex];

  function handleAnswerChange(answer: QuestionAnswer) {
    if (!currentQuestion) {
      return;
    }
    setAnswers((previous) => new Map(previous).set(currentQuestion.id, answer));
  }

  function handleNext() {
    if (currentIndex + 1 >= questions.length) {
      setIsComplete(true);
    } else {
      setCurrentIndex((index) => index + 1);
    }
  }

  if (isComplete || !currentQuestion) {
    return <CheckpointResult campaign={campaign} questions={questions} answers={answers} />;
  }

  return (
    <CheckpointQuestionStep
      // Keyed per question so each question's local state — most
      // importantly `isExpired` in CheckpointQuestionStep — starts fresh.
      // Without this, a timeout on question N (which sets isExpired=true
      // and auto-advances) would leave question N+1 permanently disabled,
      // since React would otherwise reuse the same component instance.
      key={currentQuestion.id}
      question={currentQuestion}
      questionNumber={currentIndex + 1}
      totalQuestions={questions.length}
      respondentId={respondentId}
      answer={answers.get(currentQuestion.id)}
      onAnswerChange={handleAnswerChange}
      onNext={handleNext}
    />
  );
}
