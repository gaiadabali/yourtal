"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { PresentedQuestion } from "@yourtal/contracts/question/presented-question";
import { getPlayerTranslator, type SupportedLocale } from "./player-i18n";

/** The video box. Only ~220px tall on a phone, which is why a question sits under it there. */
export const PLAYER_BOX_CLASS = "relative aspect-video w-full overflow-hidden rounded-lg bg-fg";

/**
 * The video box and its question as one unit: the question covers the box from
 * `sm` up and sits under it below that (see `CheckpointOverlay`). Shared with
 * the rendered-layout lab page so the browser test measures the real classes.
 */
export function CheckpointStage({ children }: { children: ReactNode }) {
  return <div className="relative flex flex-col gap-2">{children}</div>;
}

export interface CheckpointOverlayProps {
  question: PresentedQuestion;
  questionNumber: number;
  totalQuestions: number;
  /** From the server's own present response — F10's 30s answer window. */
  answerTimerMs: number;
  /** `timedOut` is true only when the timer ran out on a question the viewer could have answered. */
  onAnswer: (selectedOptionId: string | null, timedOut: boolean) => void;
  locale: SupportedLocale;
}

/**
 * The paused, mid-video question (11.5.b): the video is already paused by
 * `use-watch-earn-session.ts` before this mounts. F10: "timeout = answered
 * wrong, never voids" — the countdown submits whatever is selected (or
 * nothing) the moment it reaches zero, rather than blocking playback
 * indefinitely.
 *
 * Only `multiple_choice` renders here. Any other type is skipped at once, with
 * no notice and no wait: the answer goes in as "no selection, not timed out",
 * which the server must still count to let the session complete (it is
 * unanswered, so no accuracy bonus for that session). Their UI belongs with
 * 6.x's checkpoint survey work.
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

  const rootRef = useRef<HTMLDivElement | null>(null);
  const supported = question.type === "multiple_choice";

  const submit = (optionId: string | null, timedOut = false) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    onAnswer(optionId, timedOut);
  };

  // Below `sm` the question sits under the video, not on it: bring it into
  // view and give it focus so a phone viewer never has to hunt for it.
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  // An unsupported type is skipped on mount, not timed out.
  useEffect(() => {
    if (!supported) submit(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per question; `submit` is guarded by submittedRef.
  }, []);

  useEffect(() => {
    if (!supported) return;
    const interval = window.setInterval(() => {
      setRemainingSeconds((current) => {
        const next = current - 1;
        if (next <= 0) {
          window.clearInterval(interval);
          submit(selectedRef.current, true);
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

  if (!supported) return null;

  return (
    // Under the video below `sm` (the video box is only ~220px tall on a
    // phone, too short for a question with long options), over it from `sm`
    // up. The body scrolls, the header stays put, and `my-auto` (not
    // `justify-center`) centres short content without clipping tall content.
    <div
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="checkpoint-prompt"
      className="z-20 flex flex-col gap-3 rounded-lg bg-fg p-4 text-primary-fg focus-visible:outline-none sm:absolute sm:inset-0 sm:bg-fg/90 sm:p-6"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 text-sm font-sans">
        <span>{t("checkpoint.progress", { current: questionNumber, total: totalQuestions })}</span>
        <span role="timer" aria-live="off" className="tabular-nums">
          {t("checkpoint.timeRemaining", { seconds: remainingSeconds })}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="my-auto flex flex-col gap-3">
          <h2 id="checkpoint-prompt" className="text-lg font-sans font-semibold break-words">
            {question.prompt}
          </h2>
          <div
            className="flex flex-col gap-2"
            role="radiogroup"
            aria-labelledby="checkpoint-prompt"
          >
            {question.options.map((option) => (
              // eslint-disable-next-line yt-b/prefer-primitives -- a `role="radio"` option in a custom radiogroup, not a standalone action button; @yourtal/ui/button has no radio variant and Radix's own RadioGroup would add a dependency for one already-simple, fully-custom-styled control.
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected === option.id}
                disabled={submitting}
                onClick={() => choose(option.id)}
                className="rounded-control border border-white/30 bg-white/10 px-4 py-3 text-left text-body font-sans break-words text-primary-fg disabled:opacity-60 aria-checked:border-white aria-checked:bg-white/25"
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {submitting ? t("checkpoint.submitting") : ""}
      </p>
    </div>
  );
}
