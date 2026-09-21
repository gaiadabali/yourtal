"use client";

import { useEffect, useRef, useState } from "react";
import type { useTranslations } from "next-intl";

/** `Translator` for the `checkpoint` namespace — see `next-intl`'s `useTranslations`. Its test (`use-question-timer.test.tsx`) obtains one the identical way, via `useTranslations("checkpoint")` inside a `renderHook` wrapper, rather than `createTranslator`, precisely so this type needs no widening. */
type CheckpointTranslator = ReturnType<typeof useTranslations<"checkpoint">>;

export interface QuestionTimerState {
  remainingSeconds: number;
  /**
   * Text for a visually-hidden `aria-live="polite"` region. It only
   * changes at meaningful thresholds (start, halfway, and a 10-5-3-2-1
   * final countdown) — see `announcedThresholds` below. On every other
   * tick this stays the same string, so the live region does not fire
   * every second, which would be unusable spam for a screen-reader user
   * under time pressure (docs/tasks/phase-u-ui.md YT-0413).
   */
  announcement: string;
}

const FINAL_COUNTDOWN_THRESHOLDS = [10, 5, 3, 2, 1] as const;

function announcedThresholds(totalSeconds: number): Set<number> {
  const halfway = Math.floor(totalSeconds / 2);
  return new Set(
    [halfway, ...FINAL_COUNTDOWN_THRESHOLDS].filter(
      (threshold) => threshold > 0 && threshold < totalSeconds,
    ),
  );
}

function startAnnouncement(t: CheckpointTranslator, totalSeconds: number): string {
  return t("timer.startAnnouncement", { seconds: totalSeconds });
}

/**
 * Drives a per-question countdown and its accessible announcements. The
 * visible countdown (rendered by `checkpoint-timer.tsx`) updates every
 * second on its own via `remainingSeconds`; `announcement` is the
 * separate, deliberately sparse text a screen reader actually speaks.
 *
 * YT-0405: takes the caller's `useTranslations("checkpoint")` result rather
 * than calling the hook itself, so this stays a plain state/effect hook
 * with no i18n dependency of its own beyond the strings it is handed.
 */
export function useQuestionTimer(
  totalSeconds: number,
  onExpire: () => void,
  t: CheckpointTranslator,
): QuestionTimerState {
  const [remainingSeconds, setRemainingSeconds] = useState(totalSeconds);
  const [announcement, setAnnouncement] = useState(() => startAnnouncement(t, totalSeconds));
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;
  const thresholdsRef = useRef(announcedThresholds(totalSeconds));
  const translatorRef = useRef(t);
  translatorRef.current = t;

  useEffect(() => {
    setRemainingSeconds(totalSeconds);
    setAnnouncement(startAnnouncement(t, totalSeconds));
    thresholdsRef.current = announcedThresholds(totalSeconds);
    // Only re-syncs when `totalSeconds` (a new question) changes — `t` is
    // read via `translatorRef.current` in the tick effect below rather than
    // listed here, and this repo's `react-hooks/exhaustive-deps` only runs
    // on .tsx/.jsx files (see `use-voucher-qr-rotation.ts`), so there is
    // nothing for a disable comment to suppress in this plain `.ts` file.
  }, [totalSeconds]);

  useEffect(() => {
    if (remainingSeconds <= 0) {
      onExpireRef.current();
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setRemainingSeconds((current) => {
        const next = current - 1;
        if (next === 0) {
          setAnnouncement(translatorRef.current("timer.expiredAnnouncement"));
        } else if (thresholdsRef.current.has(next)) {
          setAnnouncement(translatorRef.current("timer.remainingAnnouncement", { seconds: next }));
        }
        return next;
      });
    }, 1000);
    return () => window.clearTimeout(timeoutId);
  }, [remainingSeconds]);

  return { remainingSeconds, announcement };
}
