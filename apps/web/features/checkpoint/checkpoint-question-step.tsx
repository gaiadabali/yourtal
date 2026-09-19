"use client";

import { useId, useState } from "react";
import { Button } from "@yourtal/ui/button";
import type { Question } from "@yourtal/contracts/question";
import { CheckpointProgress } from "./checkpoint-progress";
import { CheckpointTimer } from "./checkpoint-timer";
import { isAnswerPresent, type QuestionAnswer } from "./checkpoint-types";
import { QuestionAnswerView } from "./question-answer-view";

export interface CheckpointQuestionStepProps {
  question: Question;
  questionNumber: number;
  totalQuestions: number;
  respondentId: string;
  answer: QuestionAnswer | undefined;
  onAnswerChange: (answer: QuestionAnswer) => void;
  onNext: () => void;
}

/**
 * One question, conversationally: progress, timer, prompt, the
 * type-specific answer control, and a single "Lanjut" (Next) action
 * (docs/tasks/phase-u-ui.md YT-0413). When the timer expires, input is
 * disabled and the step advances on its own with whatever answer exists —
 * per docs/06 section 4.2 the platform gates reward on *answering*, not on
 * beating the clock, so a timeout is never a dead end, just a missed
 * chance at that question's correctness.
 */
export function CheckpointQuestionStep({
  question,
  questionNumber,
  totalQuestions,
  respondentId,
  answer,
  onAnswerChange,
  onNext,
}: CheckpointQuestionStepProps) {
  const promptId = useId();
  const [isExpired, setIsExpired] = useState(false);

  function handleExpire() {
    setIsExpired(true);
    onNext();
  }

  const canProceed = !isExpired && isAnswerPresent(question, answer);
  const isLastQuestion = questionNumber === totalQuestions;

  return (
    <section aria-labelledby={promptId} className="flex flex-col gap-6">
      <CheckpointProgress current={questionNumber} total={totalQuestions} />
      <CheckpointTimer
        key={question.id}
        totalSeconds={question.timerSeconds}
        onExpire={handleExpire}
      />
      <h2 id={promptId} className="text-lg font-sans font-semibold text-fg">
        {question.prompt}
      </h2>
      <QuestionAnswerView
        question={question}
        respondentId={respondentId}
        answer={answer}
        onAnswerChange={onAnswerChange}
        promptId={promptId}
        disabled={isExpired}
      />
      <Button onClick={onNext} disabled={!canProceed}>
        {isLastQuestion ? "Lihat hasil" : "Lanjut"}
      </Button>
    </section>
  );
}
