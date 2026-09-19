"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@yourtal/ui/button";
import type { RankedQuestion } from "@yourtal/contracts/question";
import type { RankedAnswer } from "../checkpoint-types";
import { seededShuffle } from "../checkpoint-seeded-shuffle";

export interface RankedQuestionViewProps {
  question: RankedQuestion;
  respondentId: string;
  answer: RankedAnswer | undefined;
  onAnswerChange: (answer: RankedAnswer) => void;
  promptId: string;
  disabled?: boolean;
}

function focusKey(itemId: string, direction: -1 | 1): string {
  return `${itemId}:${direction}`;
}

/**
 * Keyboard-operable reordering is the PRIMARY interaction here, not a
 * fallback bolted onto drag-and-drop — drag-and-drop alone excludes
 * keyboard and screen-reader users, so no drag-and-drop is implemented at
 * all (docs/tasks/phase-u-ui.md YT-0413 is explicit that this would not be
 * good enough). Each item gets real "Naik"/"Turun" (move up/down) buttons;
 * moving an item announces its new position through a visually-hidden
 * live region, and focus is restored to the button the user just used (or
 * its opposite, if that one is now disabled at a list boundary) so the
 * keyboard flow never gets dropped mid-reorder.
 *
 * The initial order is itself seeded-shuffled per respondent (docs/06
 * section 4.3) — there is no "correct" order for a ranked/opinion
 * question, so shuffling the starting presentation is exactly the kind of
 * option set the anti-sharing shuffle is for.
 */
export function RankedQuestionView({
  question,
  respondentId,
  answer,
  onAnswerChange,
  promptId,
  disabled,
}: RankedQuestionViewProps) {
  const initialOrder = useMemo(
    () =>
      seededShuffle(question.items, [question.campaignId, question.id, respondentId]).map(
        (item) => item.id,
      ),
    [question.campaignId, question.id, question.items, respondentId],
  );
  const [order, setOrder] = useState<string[]>(() => answer?.orderedItemIds ?? initialOrder);
  const [announcement, setAnnouncement] = useState("");
  const pendingFocusKey = useRef<string | null>(null);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const itemsById = useMemo(
    () => new Map(question.items.map((item) => [item.id, item])),
    [question.items],
  );

  useEffect(() => {
    if (!answer) {
      // An unmodified shuffled ranking is itself a valid answer — commit it
      // once so "Lanjut" is never blocked on a ranked question the
      // respondent genuinely agrees with as-shown.
      onAnswerChange({ type: "ranked", orderedItemIds: initialOrder });
    }
    // Runs once per mounted question; all later changes flow through moveItem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const key = pendingFocusKey.current;
    if (key) {
      buttonRefs.current.get(key)?.focus();
      pendingFocusKey.current = null;
    }
  }, [order]);

  function moveItem(itemId: string, direction: -1 | 1) {
    const index = order.indexOf(itemId);
    const targetIndex = index + direction;
    if (index === -1 || targetIndex < 0 || targetIndex >= order.length) {
      return;
    }
    const next = [...order];
    const moved = next[index] as string;
    const displaced = next[targetIndex] as string;
    next[index] = displaced;
    next[targetIndex] = moved;
    setOrder(next);
    onAnswerChange({ type: "ranked", orderedItemIds: next });

    const sameDirectionStillValid =
      targetIndex + direction >= 0 && targetIndex + direction < next.length;
    pendingFocusKey.current = focusKey(
      itemId,
      sameDirectionStillValid ? direction : (-direction as -1 | 1),
    );

    const label = itemsById.get(itemId)?.label ?? "";
    setAnnouncement(`${label} dipindahkan ke posisi ${targetIndex + 1} dari ${next.length}.`);
  }

  return (
    <div className="flex flex-col gap-2">
      <ol aria-labelledby={promptId} className="flex flex-col gap-2">
        {order.map((itemId, index) => {
          const item = itemsById.get(itemId);
          if (!item) {
            return null;
          }
          return (
            <li
              key={itemId}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface p-3"
            >
              <span className="text-sm font-sans text-fg">
                <span className="mr-2 font-semibold text-fg-muted">{index + 1}.</span>
                {item.label}
              </span>
              <span className="flex gap-1">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  aria-label={`Naik: ${item.label}`}
                  disabled={disabled || index === 0}
                  onClick={() => moveItem(itemId, -1)}
                  ref={(element) => {
                    if (element) {
                      buttonRefs.current.set(focusKey(itemId, -1), element);
                    }
                  }}
                >
                  Naik
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  aria-label={`Turun: ${item.label}`}
                  disabled={disabled || index === order.length - 1}
                  onClick={() => moveItem(itemId, 1)}
                  ref={(element) => {
                    if (element) {
                      buttonRefs.current.set(focusKey(itemId, 1), element);
                    }
                  }}
                >
                  Turun
                </Button>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
