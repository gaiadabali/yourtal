"use client";

import { Clock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Question } from "./lab-data";

const SECONDS = 30;

/**
 * The mid-video question. The video is paused behind it; a timeout counts as
 * wrong but never voids the watch.
 */
export function QuestionSheet({
  question,
  onDone,
}: {
  question: Question;
  onDone: (correct: boolean) => void;
}) {
  const [left, setLeft] = useState(SECONDS);
  const [picked, setPicked] = useState<number | null>(null);
  const first = useRef<HTMLButtonElement | null>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => first.current?.focus(), []);

  useEffect(() => {
    if (picked !== null) {
      const t = window.setTimeout(() => done.current(picked === question.answer), 1100);
      return () => window.clearTimeout(t);
    }
    if (left <= 0) {
      done.current(false);
      return;
    }
    const t = window.setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [left, picked, question.answer]);

  const verdict =
    picked === null
      ? null
      : picked === question.answer
        ? "Correct: bonus unlocked"
        : "Not quite. You still earn the base points";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="question-prompt"
      className="lab-pop absolute inset-x-0 bottom-0 z-40 flex flex-col gap-4 rounded-t-3xl border-t border-(--lab-border) bg-(--lab-surface) p-5 pb-8 shadow-2xl"
    >
      <div className="flex items-center justify-between text-sm font-semibold text-(--lab-fg-muted)">
        <span>Quick question</span>
        <span className="inline-flex items-center gap-1 tabular-nums" aria-live="off">
          <Clock size={14} aria-hidden="true" /> {left} s
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-(--lab-surface-2)"
        role="progressbar"
        aria-label="Time left"
        aria-valuemin={0}
        aria-valuemax={SECONDS}
        aria-valuenow={left}
      >
        <div
          className="h-full rounded-full bg-(--lab-accent) transition-[width] duration-1000 ease-linear"
          style={{ width: `${(left / SECONDS) * 100}%` }}
        />
      </div>
      <p
        id="question-prompt"
        className="font-(family-name:--lab-display) text-xl leading-snug font-extrabold"
      >
        {question.prompt}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {question.options.map((option, i) => {
          const state =
            picked === null
              ? "border-(--lab-border) bg-(--lab-canvas)"
              : i === question.answer
                ? "border-transparent bg-(--lab-accent) text-(--lab-fg-on-accent)"
                : i === picked
                  ? "border-(--lab-fg-muted) bg-(--lab-surface-2) line-through"
                  : "border-(--lab-border) bg-(--lab-canvas) opacity-60";
          return (
            <button
              key={option}
              ref={i === 0 ? first : undefined}
              type="button"
              disabled={picked !== null}
              onClick={() => setPicked(i)}
              className={`min-h-14 rounded-2xl border-2 px-3 text-left font-semibold ${state}`}
            >
              {option}
            </button>
          );
        })}
      </div>
      <p role="status" className="min-h-6 text-sm font-semibold">
        {verdict}
      </p>
    </div>
  );
}
