"use client";

import { useEffect, useRef, useState } from "react";
import type { PresentedQuestion } from "@yourtal/contracts/question/presented-question";
import { getPlayerTranslator, type SupportedLocale } from "./player-i18n";

export interface CheckpointOverlayProps {
  question: PresentedQuestion;
  questionNumber: number;
  totalQuestions: number;
  /** From the server's own present response — F10's 30s answer window. */
  answerTimerMs: number;
  onAnswer: (selectedOptionId: string | null) => void;
  locale: SupportedLocale;
}

/**
 * The paused, mid-video question (11.5.b): the video is already paused by
 * `use-watch-earn-session.ts` before this mounts. F10: "timeout = answered
 * wrong, never voids" — the countdown submits whatever is selected (or
 * nothing) the moment it reaches zero, rather than blocking playback
 * indefinitely.
 *
 * Every demo campaign's bank is `multiple_choice` only
 * (`packages/media/src/demo-media.ts`); the other four question types render
 * a plain wait-out-the-timer fallback rather than dead-ending the session —
 * building their full UI here belongs with 6.x's checkpoint survey work,
 * which already has one, in a different namespace.
 */
export function CheckpointOverlay({
  question,
  questionNumber,
  totalQuestions,
  answerTimerMs,
  onAnswer,
  locale,
}: CheckpointOverlayProps) {
  const t = getPlayerTranslator(locale);
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(Math.ceil(answerTimerMs / 1000));
  const selectedRef = useRef<string | null>(null);
  const submittedRef = useRef(false);

  const submit = (optionId: string | null) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    onAnswer(optionId);
  };

  useEffect(() => {
    const interval = window.setInterval(() => {
      setRemainingSeconds((current) => {
        const next = current - 1;
        if (next <= 0) {
          window.clearInterval(interval);
          submit(selectedRef.current);
          return 0;
        }
        return next;
      });
    }, 1_000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one timer per question, keyed by the parent's `key={question.id}`; re-running on every render would restart the countdown.
  }, []);

  function choose(optionId: string) {
    if (submitting) return;
    selectedRef.current = optionId;
    setSelected(optionId);
    submit(optionId);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="checkpoint-prompt"
      className="absolute inset-0 z-20 flex flex-col justify-center gap-4 bg-fg/90 p-6 text-primary-fg"
    >
      <div className="flex items-center justify-between text-sm font-sans">
        <span>{t("checkpoint.progress", { current: questionNumber, total: totalQuestions })}</span>
        <span role="timer" aria-live="off" className="tabular-nums">
          {t("checkpoint.timeRemaining", { seconds: remainingSeconds })}
        </span>
      </div>
      <h2 id="checkpoint-prompt" className="text-lg font-sans font-semibold">
        {question.prompt}
      </h2>
      {question.type === "multiple_choice" ? (
        <div className="flex flex-col gap-2" role="radiogroup" aria-labelledby="checkpoint-prompt">
          {question.options.map((option) => (
            // eslint-disable-next-line yt-b/prefer-primitives -- a `role="radio"` option in a custom radiogroup, not a standalone action button; @yourtal/ui/button has no radio variant and Radix's own RadioGroup would add a dependency for one already-simple, fully-custom-styled control.
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected === option.id}
              disabled={submitting}
              onClick={() => choose(option.id)}
              className="rounded-control border border-white/30 bg-white/10 px-4 py-3 text-left text-body font-sans text-primary-fg disabled:opacity-60 aria-checked:border-white aria-checked:bg-white/25"
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-body-sm font-sans text-primary-fg/80">{t("checkpoint.unsupported")}</p>
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {submitting ? t("checkpoint.submitting") : ""}
      </p>
    </div>
  );
}
