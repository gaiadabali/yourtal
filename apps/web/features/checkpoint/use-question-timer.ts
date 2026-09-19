"use client";

import { useEffect, useRef, useState } from "react";

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
  return new Set([halfway, ...FINAL_COUNTDOWN_THRESHOLDS].filter((threshold) => threshold > 0 && threshold < totalSeconds));
}

function startAnnouncement(totalSeconds: number): string {
  return `Anda memiliki ${totalSeconds} detik untuk menjawab pertanyaan ini.`;
}

/**
 * Drives a per-question countdown and its accessible announcements. The
 * visible countdown (rendered by `checkpoint-timer.tsx`) updates every
 * second on its own via `remainingSeconds`; `announcement` is the
 * separate, deliberately sparse text a screen reader actually speaks.
 */
export function useQuestionTimer(totalSeconds: number, onExpire: () => void): QuestionTimerState {
  const [remainingSeconds, setRemainingSeconds] = useState(totalSeconds);
  const [announcement, setAnnouncement] = useState(() => startAnnouncement(totalSeconds));
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;
  const thresholdsRef = useRef(announcedThresholds(totalSeconds));

  useEffect(() => {
    setRemainingSeconds(totalSeconds);
    setAnnouncement(startAnnouncement(totalSeconds));
    thresholdsRef.current = announcedThresholds(totalSeconds);
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
          setAnnouncement("Waktu untuk pertanyaan ini habis.");
        } else if (thresholdsRef.current.has(next)) {
          setAnnouncement(`${next} detik tersisa.`);
        }
        return next;
      });
    }, 1000);
    return () => window.clearTimeout(timeoutId);
  }, [remainingSeconds]);

  return { remainingSeconds, announcement };
}
